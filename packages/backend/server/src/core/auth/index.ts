import './config';

import { Module } from '@nestjs/common';

import { BackendRuntimeModule } from '../backend-runtime';
import { EntitlementModule } from '../entitlement';
import { FeatureModule } from '../features';
import { MailModule } from '../mail';
import { QuotaModule } from '../quota';
import { UserModule } from '../user';
import { AccessTokenService } from './access-token';
import { AuthSessionService } from './auth-session';
import { AuthController } from './controller';
import { AuthGuard, AuthWebsocketOptionsProvider } from './guard';
import { AuthCronJob } from './job';
import { MagicLinkAuthService } from './magic-link';
import { AuthResolver } from './resolver';
import { AuthService } from './service';
import { SessionIssuer } from './session-issuer';
import { AuthSigningKeyRing } from './signing-key';
import { AuthSigningKeyResolver } from './signing-key-resolver';

@Module({
  imports: [
    BackendRuntimeModule,
    FeatureModule,
    EntitlementModule,
    UserModule,
    QuotaModule,
    MailModule,
  ],
  providers: [
    AuthService,
    AuthResolver,
    AuthGuard,
    AccessTokenService,
    SessionIssuer,
    MagicLinkAuthService,
    AuthSessionService,
    AuthSigningKeyRing,
    AuthSigningKeyResolver,
    AuthWebsocketOptionsProvider,
  ],
  exports: [
    AuthService,
    AuthGuard,
    AccessTokenService,
    SessionIssuer,
    MagicLinkAuthService,
    AuthSessionService,
    AuthSigningKeyRing,
    AuthWebsocketOptionsProvider,
  ],
  controllers: [AuthController],
})
export class AuthModule {}

@Module({
  imports: [BackendRuntimeModule],
  providers: [AuthCronJob],
})
export class AuthWorkerModule {}

export * from './guard';
export * from './input';
export { MagicLinkAuthService } from './magic-link';
export * from './access-token';
export { AuthSessionService } from './auth-session';
export { ClientTokenType } from './resolver';
export { AuthService, SessionIssuer };
export * from './session';
export { AuthSigningKeyRing } from './signing-key';
