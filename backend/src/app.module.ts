import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { SheetsModule } from './sheets/sheets.module';
import { PrismaModule } from './prisma/prisma.module';
import { SyncModule } from './sync/sync.module';
import { DataModule } from './data/data.module';
import { SupportModule } from './support/support.module';
import { PgStateModule } from './pg-state/pg-state.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'backend/.env', '../.env'],
    }),
    PrismaModule,
    PgStateModule,
    DataModule,
    SyncModule,
    TelegramModule,
    RedisModule,
    SheetsModule,
    SupportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
