import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RouteStatus } from '@prisma/client';

const AVAILABILITY_ENABLED_KEY = 'system:availability:enabled';

@Controller('api/public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('driver/:id')
  async getDriver(@Param('id') id: string) {
    const enabled = await this.redis.get<boolean>(AVAILABILITY_ENABLED_KEY);
    if (!enabled) return { ok: false, message: 'O sistema de disponibilidade está fechado no momento.' };

    const driverId = id.trim();
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, vehicleType: true, priorityScore: true, ds: true },
    });
    if (!driver) return { ok: false, message: 'Motorista não encontrado.' };

    // Verifica rota já atribuída
    const activeRoute = await (this.prisma as any).route.findFirst({
      where: { driverId, status: { in: ['ATRIBUIDA', 'APROVADA'] } },
      select: { atId: true },
    });
    if (activeRoute) {
      return { ok: false, message: `Você já possui a rota ${activeRoute.atId} atribuída.` };
    }

    // Verifica disponibilidade já registrada hoje
    const today = new Date().toISOString().slice(0, 10);
    const existing = await (this.prisma as any).driverQueueAvailability.findUnique({
      where: { driverId_date: { driverId, date: today } },
      select: { clusters: true },
    });
    if (existing) {
      return { ok: false, message: 'Você já registrou disponibilidade hoje.' };
    }

    return { ok: true, driver };
  }

  @Get('clusters')
  async getClusters(@Query('vehicleType') vehicleType?: string) {
    const isMoto = (vehicleType || '').trim().toUpperCase() === 'MOTO';

    const where: any = { status: RouteStatus.DISPONIVEL, cluster: { not: null } };
    if (isMoto) {
      where.requiredVehicleType = { equals: 'MOTO', mode: 'insensitive' };
    }

    const rows = await this.prisma.route.findMany({
      where,
      select: { cluster: true, requiredVehicleType: true },
      distinct: ['cluster'],
      orderBy: { cluster: 'asc' },
    });
    const clusters = rows
      .filter((r) => r.cluster)
      .map((r) => ({ cluster: r.cluster!, vehicleType: r.requiredVehicleType }));
    return { ok: true, clusters };
  }

  @Post('availability')
  async markAvailability(
    @Body() body: { driverId: string; clusters: string[] },
  ) {
    const { driverId, clusters } = body;
    if (!driverId || !clusters?.length) {
      return { ok: false, message: 'Dados inválidos.' };
    }

    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId.trim() },
      select: { id: true, vehicleType: true },
    });
    if (!driver) return { ok: false, message: 'Motorista não encontrado.' };

    const today = new Date().toISOString().slice(0, 10);

    await (this.prisma as any).driverQueueAvailability.upsert({
      where: { driverId_date: { driverId: driver.id, date: today } },
      create: { driverId: driver.id, clusters, vehicleType: driver.vehicleType, date: today },
      update: { clusters, vehicleType: driver.vehicleType },
    });

    return { ok: true, message: 'Disponibilidade registrada com sucesso!' };
  }
}
