import { Module } from '@nestjs/common';
import { AdminCommonModule } from '../admin-common/admin-common.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AdminCommonModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
