import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PgLockService } from './pg-lock.service';
import { TelegramSessionService } from './telegram-session.service';
import { TelegramKvService } from './telegram-kv.service';
import { TelegramQueueService } from './telegram-queue.service';
import { TelegramLogService } from './telegram-log.service';

@Module({
  imports: [PrismaModule],
  providers: [
    PgLockService,
    TelegramSessionService,
    TelegramKvService,
    TelegramQueueService,
    TelegramLogService,
  ],
  exports: [
    PgLockService,
    TelegramSessionService,
    TelegramKvService,
    TelegramQueueService,
    TelegramLogService,
  ],
})
export class PgStateModule {}
