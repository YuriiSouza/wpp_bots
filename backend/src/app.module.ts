import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QueueModule } from './queue/queue.module';
import { TelegramModule } from './telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { SheetsModule } from './sheets/sheets.module';
import { PrismaModule } from './prisma/prisma.module';
import { SyncModule } from './sync/sync.module';
import { DataModule } from './data/data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'backend/.env', '../.env'],
    }),
    PrismaModule,
    DataModule,
    SyncModule,
    TelegramModule,
    QueueModule,
    RedisModule,
    SheetsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
