import { Module } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
