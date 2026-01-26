import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriverService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.driver.findUnique({ where: { id } });
  }
}
