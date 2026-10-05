import {
  type ByokProvider,
  type GraphQLQuery,
  type QueryOptions,
  type QueryResponse,
  type WorkspaceByokSettingsQuery,
} from '@affine/graphql';

export const ByokStorage = {
  server: 'server',
} as const;
export type ByokStorage = (typeof ByokStorage)[keyof typeof ByokStorage];

export type ByokDefinition =
  WorkspaceByokSettingsQuery['workspace']['byokSettings']['profiles'][number]['definition'];

type ByokKeyBase = {
  id: string;
  provider: ByokProvider;
  name: string;
  description?: string | null;
  configured: boolean;
  enabled: boolean;
  sortOrder: number;
  definition: ByokDefinition;
  capabilities: string[];
  validation?: WorkspaceByokSettingsQuery['workspace']['byokSettings']['profiles'][number]['validation'];
};

export type ByokKey = ByokKeyBase & {
  storage: typeof ByokStorage.server;
  revision: number;
};

export type ByokSettings = Omit<
  WorkspaceByokSettingsQuery['workspace']['byokSettings'],
  'profiles'
> & {
  keys: ByokKey[];
};

export type ByokUsagePoint =
  WorkspaceByokSettingsQuery['workspace']['byokUsage'][number];

export type ByokTestResult = {
  ok: boolean;
  status: string;
  message?: string | null;
};

export type GqlFn = <Query extends GraphQLQuery>(
  input: QueryOptions<Query>
) => Promise<QueryResponse<Query>>;

