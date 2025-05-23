/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from "@microsoft/vscode-azext-utils";
import { InnerDeployContext } from "../IDeployContext";
import { syncTriggersPostDeploy } from "../syncTriggersPostDeploy";

export class PostDeploySyncTriggersExecuteStep extends AzureWizardExecuteStep<InnerDeployContext> {
    public priority: number = 310;
    public async execute(context: InnerDeployContext): Promise<void> {
        // Don't sync triggers if app is stopped https://github.com/microsoft/vscode-azurefunctions/issues/1608
        const state: string | undefined = await context.client.getState();
        // If the app is connected to a user assigned identity, we can't sync triggers
        if (state?.toLowerCase() === 'running' && !context.site.identity) {
            await syncTriggersPostDeploy(context, context.site);
        }
    }

    public shouldExecute(context: InnerDeployContext): boolean {
        // this gets set in `waitForDeploymentToComplete` for consumption plans or storage account deployments
        return !!context.syncTriggersPostDeploy;
    }
}
