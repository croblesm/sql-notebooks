/**
 * Type definitions for the MSSQL extension API.
 * Subset of types from vscode-mssql needed by the SQL Notebooks extension.
 * Source: https://github.com/microsoft/vscode-mssql
 */

declare module "vscode-mssql" {
    import * as vscode from "vscode";

    export const enum extension {
        name = "ms-mssql.mssql",
    }

    export interface IExtension {
        readonly sqlToolsServicePath: string;

        promptForConnection(
            ignoreFocusOut?: boolean,
        ): Promise<IConnectionInfo | undefined>;

        connect(
            connectionInfo: IConnectionInfo,
            saveConnection?: boolean,
        ): Promise<string>;

        listDatabases(connectionUri: string): Promise<string[]>;

        getDatabaseNameFromTreeNode(node: ITreeNodeInfo): string;

        getConnectionString(
            connectionUriOrDetails: string | ConnectionDetails,
            includePassword?: boolean,
            includeApplicationName?: boolean,
        ): Promise<string>;

        getServerInfo(connectionInfo: IConnectionInfo): IServerInfo;

        createConnectionDetails(
            connectionInfo: IConnectionInfo,
        ): ConnectionDetails;

        sendRequest(requestType: any, params?: any): Promise<any>;

        readonly connectionSharing: IConnectionSharingService;
    }

    export interface ITreeNodeInfo extends vscode.TreeItem {
        readonly connectionProfile: IConnectionInfo;
        nodeType: string;
    }

    export interface IConnectionInfo {
        server: string;
        database: string;
        user: string;
        password: string;
        email: string | undefined;
        accountId: string | undefined;
        tenantId: string | undefined;
        port: number;
        authenticationType: string;
        azureAccountToken: string | undefined;
        expiresOn: number | undefined;
        encrypt: string | boolean;
        trustServerCertificate: boolean | undefined;
        hostNameInCertificate: string | undefined;
        persistSecurityInfo: boolean | undefined;
        connectTimeout: number | undefined;
        commandTimeout: number | undefined;
        connectRetryCount: number | undefined;
        connectRetryInterval: number | undefined;
        applicationName: string | undefined;
        workstationId: string | undefined;
        applicationIntent: string | undefined;
        currentLanguage: string | undefined;
        pooling: boolean | undefined;
        maxPoolSize: number | undefined;
        minPoolSize: number | undefined;
        loadBalanceTimeout: number | undefined;
        replication: boolean | undefined;
        attachDbFilename: string | undefined;
        failoverPartner: string | undefined;
        multiSubnetFailover: boolean | undefined;
        multipleActiveResultSets: boolean | undefined;
        packetSize: number | undefined;
        typeSystemVersion: string | undefined;
        connectionString: string | undefined;
    }

    export interface IServerInfo {
        serverMajorVersion: number;
        serverMinorVersion: number;
        serverReleaseVersion: number;
        engineEditionId: number;
        serverVersion: string;
        serverLevel: string;
        serverEdition: string;
        isCloud: boolean;
        azureVersion: number;
        osVersion: string;
    }

    export interface ConnectionDetails {
        options: { [name: string]: any };
    }

    export interface IConnectionSharingService {
        getActiveEditorConnectionId(
            extensionId: string,
        ): Promise<string | undefined>;

        getActiveDatabase(extensionId: string): Promise<string | undefined>;

        getDatabaseForConnectionId(
            extensionId: string,
            connectionId: string,
        ): Promise<string | undefined>;

        connect(
            extensionId: string,
            connectionId: string,
            database?: string,
        ): Promise<string | undefined>;

        disconnect(connectionUri: string): void;

        isConnected(connectionUri: string): boolean;

        executeSimpleQuery(
            connectionUri: string,
            queryString: string,
        ): Promise<SimpleExecuteResult>;

        getServerInfo(connectionUri: string): IServerInfo;

        listDatabases(connectionUri: string): Promise<string[]>;

        getConnectionString(
            extensionId: string,
            connectionId: string,
        ): Promise<string | undefined>;
    }

    export interface SimpleExecuteResult {
        rowCount: number;
        columnInfo: IDbColumn[];
        rows: DbCellValue[][];
        messages?: ResultMessage[];
    }

    export interface ResultMessage {
        batchId?: number;
        isError: boolean;
        time?: string;
        message: string;
    }

    export interface IDbColumn {
        allowDBNull?: boolean | undefined;
        baseCatalogName: string;
        baseColumnName: string;
        baseSchemaName: string;
        baseServerName: string;
        baseTableName: string;
        columnName: string;
        columnOrdinal?: number | undefined;
        columnSize?: number | undefined;
        isAliased?: boolean | undefined;
        isAutoIncrement?: boolean | undefined;
        isExpression?: boolean | undefined;
        isHidden?: boolean | undefined;
        isIdentity?: boolean | undefined;
        isKey?: boolean | undefined;
        isBytes?: boolean | undefined;
        isChars?: boolean | undefined;
        isSqlVariant?: boolean | undefined;
        isUdt?: boolean | undefined;
        dataType: string;
    }

    export interface DbCellValue {
        displayValue: string;
        isNull: boolean;
        invariantCultureDisplayValue: string;
    }

    export const enum AuthenticationType {
        SqlLogin = "SqlLogin",
        Integrated = "Integrated",
        AzureMFA = "AzureMFA",
        AzureMFAAndUser = "AzureMFAAndUser",
        DSTSAuth = "dstsAuth",
        None = "None",
    }
}
