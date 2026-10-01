import {
  Args,
  Field,
  GraphQLISODateTime,
  InputType,
  Mutation,
  ObjectType,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLJSON, GraphQLJSONObject } from 'graphql-scalars';

import { Config, URLHelper } from '../../base';
import { DeploymentType } from '../../env';
import { Feature } from '../../models';
import { ServerConfigHandle } from '../../native';
import { CurrentUser, Public } from '../auth';
import { Admin } from '../common';
import { AvailableUserFeatureConfig } from '../features';
import { ServerService } from './service';
import { ServerConfigType } from './types';

@ObjectType()
export class PasswordLimitsType {
  @Field()
  minLength!: number;
  @Field()
  maxLength!: number;
}

@ObjectType()
export class CredentialsRequirementType {
  @Field()
  password!: PasswordLimitsType;
}

@ObjectType()
export class ReleaseVersionType {
  @Field()
  version!: string;

  @Field()
  url!: string;

  @Field(() => GraphQLISODateTime)
  publishedAt!: Date;

  @Field()
  changelog!: string;
}

@Resolver(() => ServerConfigType)
export class ServerConfigResolver {
  constructor(
    private readonly config: Config,
    private readonly url: URLHelper,
    private readonly server: ServerService,
    private readonly serverConfigHandle: ServerConfigHandle
  ) {}

  private get selfhosted() {
    return this.serverConfigHandle.deploymentType === 'selfhosted';
  }

  @Public()
  @Query(() => ServerConfigType, {
    description: 'server config',
  })
  serverConfig(): ServerConfigType {
    return {
      name:
        this.config.server.name ??
        (this.selfhosted
          ? 'AFFiNE Self-hosted'
          : env.namespaces.canary
            ? 'AFFiNE Canary Cloud'
            : env.namespaces.beta
              ? 'AFFiNE Beta Cloud'
              : 'AFFiNE Cloud'),
      version: env.version,
      baseUrl: this.url.requestBaseUrl,
      type: this.selfhosted ? DeploymentType.Selfhosted : DeploymentType.Affine,
      features: this.server.features,
    };
  }

  @ResolveField(() => CredentialsRequirementType, {
    description: 'credentials requirement',
  })
  async credentialsRequirement() {
    return {
      password: {
        minLength: this.config.auth.passwordRequirements.min,
        maxLength: this.config.auth.passwordRequirements.max,
      },
    };
  }

  @ResolveField(() => Boolean, {
    description: 'whether server has been initialized',
  })
  async initialized() {
    return this.server.initialized();
  }

  @ResolveField(() => ReleaseVersionType, {
    nullable: true,
    description: 'fetch latest available upgradable release of server',
  })
  async availableUpgrade(): Promise<ReleaseVersionType | null> {
    return null;
  }
}

@Resolver(() => ServerConfigType)
export class ServerFeatureConfigResolver extends AvailableUserFeatureConfig {
  @ResolveField(() => [Feature], {
    description: 'Features for user that can be configured',
  })
  override availableUserFeatures() {
    return super.availableUserFeatures();
  }
}

@InputType()
class UpdateAppConfigInput {
  @Field()
  module!: string;

  @Field()
  key!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  value?: any;

  @Field(() => Boolean, { nullable: true })
  clear?: boolean;
}

@ObjectType()
class AppConfigValidateResult {
  @Field()
  module!: string;

  @Field()
  key!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  value?: any;

  @Field()
  valid!: boolean;

  @Field(() => String, { nullable: true })
  error?: string;
}

@Admin()
@Resolver(() => GraphQLJSONObject)
export class AppConfigResolver {
  constructor(private readonly service: ServerService) {}

  @Query(() => GraphQLJSONObject, {
    description: 'get visible app configuration values',
  })
  async appConfig(): Promise<DeepPartial<AppConfig>> {
    return await this.service.getEffectiveAdminConfig();
  }

  @Query(() => GraphQLJSONObject, {
    description: 'get app configuration value sources and secret status',
  })
  appConfigMetadata() {
    return this.service.getAdminConfigMetadata();
  }

  @Mutation(() => GraphQLJSONObject, {
    description: 'update app configuration',
  })
  async updateAppConfig(
    @CurrentUser() me: CurrentUser,
    @Args('updates', { type: () => [UpdateAppConfigInput] })
    updates: UpdateAppConfigInput[]
  ): Promise<DeepPartial<AppConfig>> {
    return await this.service.updateConfig(me.id, updates);
  }

  @Query(() => [AppConfigValidateResult], {
    description: 'validate app configuration',
  })
  async validateAppConfig(
    @Args('updates', { type: () => [UpdateAppConfigInput] })
    updates: UpdateAppConfigInput[]
  ): Promise<AppConfigValidateResult[]> {
    return this.validateConfigInternal(updates);
  }

  private validateConfigInternal(
    updates: UpdateAppConfigInput[]
  ): AppConfigValidateResult[] {
    const errors = this.service.validateConfig(updates);

    return updates.map(update => {
      const error = errors?.find(
        error =>
          error.data.module === update.module && error.data.key === update.key
      );
      return {
        module: update.module,
        key: update.key,
        value: this.service.getAdminConfigValue(
          update.module,
          update.key,
          update.value
        ),
        valid: !error,
        error: error
          ? this.service.isSecretConfigKey(update.module, update.key)
            ? 'Invalid value'
            : error.data.hint
          : undefined,
      };
    });
  }
}
