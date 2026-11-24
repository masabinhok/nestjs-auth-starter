import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { toAuthUser, type AuthUser } from '../auth.types.js';
import {
  PasskeyDto,
  PasskeyOptionsDto,
  PasskeyRegisterVerifyDto,
  PasskeyVerifyDto,
  SignInResponseDto,
} from '../dto/auth.dto.js';
import { PasskeysService } from './passkeys.service.js';

@ApiTags('passkeys')
@Can.Anyone()
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(private readonly passkeys: PasskeysService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PasskeyDto[]> {
    return this.passkeys.list(user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('registration/options')
  registrationOptions(
    @CurrentUser() user: AuthUser,
  ): Promise<PasskeyOptionsDto> {
    return this.passkeys.registrationOptions(user);
  }

  @Post('registration/verify')
  register(
    @CurrentUser() user: AuthUser,
    @Body() dto: PasskeyRegisterVerifyDto,
  ): Promise<PasskeyDto> {
    return this.passkeys.register(
      user,
      dto.challengeId,
      dto.response,
      dto.name,
    );
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('authentication/options')
  authenticationOptions(): Promise<PasskeyOptionsDto> {
    return this.passkeys.authenticationOptions();
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('authentication/verify')
  async authenticate(
    @Body() dto: PasskeyVerifyDto,
  ): Promise<SignInResponseDto> {
    const { user, mfaRequired } = await this.passkeys.authenticate(
      dto.challengeId,
      dto.response,
    );
    return { user: toAuthUser(user), mfaRequired };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.passkeys.remove(user.id, id);
  }
}
