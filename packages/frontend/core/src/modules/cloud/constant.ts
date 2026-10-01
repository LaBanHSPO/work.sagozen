import {
  OAuthProviderType,
  ServerDeploymentType,
  ServerFeature,
} from '@affine/graphql';

import { DEFAULT_SELF_HOSTED_SERVER_NAME } from './server-name';
import type { ServerConfig, ServerMetadata } from './types';

export const BUILD_IN_SERVERS: (ServerMetadata & { config: ServerConfig })[] =
  environment.isSelfHosted
    ? [
        {
          id: 'affine-cloud',
          baseUrl: location.origin,
          // selfhosted baseUrl is `location.origin`
          // this is ok for web app, but not for desktop app
          // since we never build desktop app in selfhosted mode, so it's fine
          config: {
            serverName: DEFAULT_SELF_HOSTED_SERVER_NAME,
            features: [],
            oauthProviders: [],
            type: ServerDeploymentType.Selfhosted,
            credentialsRequirement: {
              password: {
                minLength: 8,
                maxLength: 32,
              },
            },
          },
        },
      ]
    : BUILD_CONFIG.debug
      ? [
          {
            id: 'affine-cloud',
            baseUrl: BUILD_CONFIG.isElectron
              ? 'http://localhost:8080'
              : location.origin,
            config: {
              serverName: 'AFFiNE Cloud',
              features: [
                ServerFeature.Indexer,
                ServerFeature.Copilot,
                ServerFeature.CopilotEmbedding,
                ServerFeature.OAuth,
                ServerFeature.Payment,
                ServerFeature.LocalWorkspace,
              ],
              oauthProviders: [
                OAuthProviderType.Google,
                OAuthProviderType.Apple,
              ],
              type: ServerDeploymentType.Affine,
              credentialsRequirement: {
                password: {
                  minLength: 8,
                  maxLength: 32,
                },
              },
            },
          },
        ]
      : BUILD_CONFIG.appBuildType === 'stable'
        ? [
            {
              id: 'affine-cloud',
              baseUrl: location.origin,
              config: {
                serverName: 'AFFiNE Cloud',
                features: [
                  ServerFeature.Indexer,
                  ServerFeature.Copilot,
                  ServerFeature.CopilotEmbedding,
                  ServerFeature.OAuth,
                  ServerFeature.Payment,
                  ServerFeature.LocalWorkspace,
                ],
                oauthProviders: [
                  OAuthProviderType.Google,
                  OAuthProviderType.Apple,
                ],
                type: ServerDeploymentType.Affine,
                credentialsRequirement: {
                  password: {
                    minLength: 8,
                    maxLength: 32,
                  },
                },
              },
            },
          ]
        : BUILD_CONFIG.appBuildType === 'beta'
          ? [
              {
                id: 'affine-cloud',
                baseUrl: location.origin,
                config: {
                  serverName: 'AFFiNE Cloud',
                  features: [
                    ServerFeature.Indexer,
                    ServerFeature.Copilot,
                    ServerFeature.CopilotEmbedding,
                    ServerFeature.OAuth,
                    ServerFeature.Payment,
                    ServerFeature.LocalWorkspace,
                  ],
                  oauthProviders: [
                    OAuthProviderType.Google,
                    OAuthProviderType.Apple,
                  ],
                  type: ServerDeploymentType.Affine,
                  credentialsRequirement: {
                    password: {
                      minLength: 8,
                      maxLength: 32,
                    },
                  },
                },
              },
            ]
          : BUILD_CONFIG.appBuildType === 'internal'
            ? [
                {
                  id: 'affine-cloud',
                  baseUrl: location.origin,
                  config: {
                    serverName: DEFAULT_SELF_HOSTED_SERVER_NAME,
                    features: [
                      ServerFeature.Indexer,
                      ServerFeature.Copilot,
                      ServerFeature.CopilotEmbedding,
                      ServerFeature.OAuth,
                      ServerFeature.Payment,
                      ServerFeature.LocalWorkspace,
                    ],
                    oauthProviders: [
                      OAuthProviderType.Google,
                      OAuthProviderType.Apple,
                    ],
                    type: ServerDeploymentType.Selfhosted,
                    credentialsRequirement: {
                      password: {
                        minLength: 8,
                        maxLength: 32,
                      },
                    },
                  },
                },
              ]
            : BUILD_CONFIG.appBuildType === 'canary'
              ? [
                  {
                    id: 'affine-cloud',
                    baseUrl: BUILD_CONFIG.isNative
                      ? 'https://affine.fail'
                      : location.origin,
                    config: {
                      serverName: 'AFFiNE Cloud',
                      features: [
                        ServerFeature.Indexer,
                        ServerFeature.Copilot,
                        ServerFeature.CopilotEmbedding,
                        ServerFeature.OAuth,
                        ServerFeature.Payment,
                        ServerFeature.LocalWorkspace,
                      ],
                      oauthProviders: [
                        OAuthProviderType.Google,
                        OAuthProviderType.Apple,
                      ],
                      type: ServerDeploymentType.Affine,
                      credentialsRequirement: {
                        password: {
                          minLength: 8,
                          maxLength: 32,
                        },
                      },
                    },
                  },
                ]
              : [];

export function getOfficialTelemetryEndpoint(
  _channel = BUILD_CONFIG.appBuildType
): string {
  return '';
}
