/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SlotConfigNamesResource, StringDictionary } from '@azure/arm-appservice';
import { AzExtTreeItem, DialogResponses, IActionContext, TreeItemIconPath, createContextValue } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, l10n } from 'vscode';
import { AppSettingsTreeItem, validateAppSettingKey } from './AppSettingsTreeItem';

/**
 * NOTE: This leverages a command with id `ext.prefix + '.toggleAppSettingVisibility'` that should be registered by each extension
 */
export class AppSettingTreeItem extends AzExtTreeItem {
    public static contextValue: string = 'applicationSettingItem';
    public static contextValueNoSlots: string = 'applicationSettingItemNoSlots';
    public get contextValue(): string {
        const contextValue = this.parent.supportsSlots ? AppSettingTreeItem.contextValue : AppSettingTreeItem.contextValueNoSlots;
        if (isSettingConnectionString(this._key, this._value)) {
            return createContextValue([contextValue, ...this.parent.contextValuesToAdd, 'convertSetting']);
        }

        return createContextValue([contextValue, ...this.parent.contextValuesToAdd]);
    }
    public readonly parent: AppSettingsTreeItem;

    private _key: string;
    private _value: string;
    private _hideValue: boolean;

    private constructor(parent: AppSettingsTreeItem, key: string, value: string) {
        super(parent);
        this._key = key;
        this._value = value;
        this._hideValue = true;
        this.valuesToMask.push(key, value);
    }

    public static async createAppSettingTreeItem(context: IActionContext, parent: AppSettingsTreeItem, key: string, value: string): Promise<AppSettingTreeItem> {
        const ti: AppSettingTreeItem = new AppSettingTreeItem(parent, key, value);
        // check if it's a slot setting
        await ti.refreshImpl(context);
        return ti;
    }

    public get id(): string {
        return this._key;
    }

    public get label(): string {
        return this._hideValue ? `${this._key}=Hidden value. Click to view.` : `${this._key}=${this._value}`;
    }

    public get iconPath(): TreeItemIconPath {
        // Change symbol to warning if the settings uses connection strings
        if (isSettingConnectionString(this._key, this._value) && !(this.contextValue.includes('container'))) {
            return new ThemeIcon('warning');
        }
        return new ThemeIcon('symbol-constant');
    }

    public get tooltip(): string | undefined {
        // Only add tooltip if the setting uses connection strings
        if (isSettingConnectionString(this._key, this._value)) {
            return l10n.t('This setting contains a connection string. For improved security, please convert to a managed identity.');
        }
        return undefined;
    }

    public get commandId(): string {
        return this.parent.extensionPrefix + '.toggleAppSettingVisibility';
    }

    public get value(): string {
        return this._value;
    }

    public async edit(context: IActionContext): Promise<void> {
        const newValue: string = await context.ui.showInputBox({
            prompt: `Enter setting value for "${this._key}"`,
            stepName: 'appSettingValue',
            value: this._value
        });

        await this.parent.editSettingItem(this._key, this._key, newValue, context);
        this._value = newValue;
        await this.refresh(context);
    }

    public async rename(context: IActionContext): Promise<void> {
        const settings: StringDictionary = await this.parent.ensureSettings(context);

        const client = await this.parent.clientProvider.createClient(context);
        const oldKey: string = this._key;
        const newKey: string = await context.ui.showInputBox({
            prompt: `Enter a new name for "${oldKey}"`,
            stepName: 'appSettingName',
            value: this._key,
            validateInput: (v: string): string | undefined => validateAppSettingKey(settings, client, v, oldKey)
        });

        await this.parent.editSettingItem(oldKey, newKey, this._value, context);
        this._key = newKey;
        await this.refresh(context);
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        await context.ui.showWarningMessage(`Are you sure you want to delete setting "${this._key}"?`, { modal: true, stepName: 'confirmDelete' }, DialogResponses.deleteResponse);
        await this.parent.deleteSettingItem(this._key, context);
    }

    public async toggleValueVisibility(context: IActionContext): Promise<void> {
        this._hideValue = !this._hideValue;
        await this.refresh(context);
    }

    public async toggleSlotSetting(context: IActionContext): Promise<void> {
        const client = await this.parent.clientProvider.createClient(context);
        if (client.updateSlotConfigurationNames && client.listSlotConfigurationNames) {
            const slotSettings: SlotConfigNamesResource = await client.listSlotConfigurationNames();
            if (!slotSettings.appSettingNames) {
                slotSettings.appSettingNames = [];
            }
            const slotSettingIndex: number = slotSettings.appSettingNames.findIndex((value: string) => { return value === this._key; });

            if (slotSettingIndex >= 0) {
                slotSettings.appSettingNames.splice(slotSettingIndex, 1);
            } else {
                slotSettings.appSettingNames.push(this._key);
            }

            await client.updateSlotConfigurationNames(slotSettings);
            await this.refresh(context);
        } else {
            throw Error(l10n.t('Toggling slot settings is not supported.'));
        }
    }

    public async refreshImpl(context: IActionContext): Promise<void> {
        const client = await this.parent.clientProvider.createClient(context);
        if (client.listSlotConfigurationNames) {
            const slotSettings: SlotConfigNamesResource = await client.listSlotConfigurationNames();
            if (slotSettings.appSettingNames && slotSettings.appSettingNames.find((value: string) => { return value === this._key; })) {
                this.description = l10n.t('Slot Setting');
            } else {
                this.description = undefined;
            }
        }
    }
}

export function isSettingConnectionString(key: string, value: string): boolean {
    if (!value || value === 'UseDevelopmentStorage=true' || key === 'DEPLOYMENT_STORAGE_CONNECTION_STRING') {
        return false;
    }

    if ((/DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+;EndpointSuffix=[^;]+/).test(value)) {
        // Storage connections strings are of the above format
        return true;
    } else if ((/Endpoint=sb:\/\/[^;]+;SharedAccessKeyName=[^;]+;SharedAccessKey=[^;]+(?:;EntityPath=[^;]+)?/).test(value)) {
        // Event Hub and Service bus connections strings are of the above format
        return true;
    } else if ((/AccountEndpoint=https:\/\/[^;]+;AccountKey=[^;]+;/).test(value)) {
        // Cosmos DB connections strings are of the above format
        return true;
    }

    return false;
}
