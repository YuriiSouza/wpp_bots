import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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
  async getClusters() {
    const clusters = [
      'Abadiania - z',
      'Campo Limpo',
      'Gameleira de Goias',
      'Goianapolis',
      'Leopoldo de Bulhões',
      'Neropolis',
      'Nova Veneza',
      'Ouro Verde',
      'Silvania',
      'Terezopolis',
      'Vianópolis - z',
      'Adriana Parque',
      'Aldeia dos Sonhos',
      'Alexandrina',
      'Alvorada',
      'Bandeiras',
      'Bougainville',
      'Calixtolandia',
      'Centro',
      'DAIA',
      'Fabril',
      'Filostro',
      'Formosa',
      'Frei Eustaquio',
      'Iracema',
      'Itamaraty',
      'Jaiara',
      'Jardim Primavera',
      'Jardim Promissão',
      'Jibran el Hadj',
      'Jundiai',
      'Lourdes',
      'Munir Calixto',
      'Paraiso',
      'Pirineus',
      'Recanto do Sol',
      'Residencial Arco-Iris',
      'Santa Isabel',
      'São Vicente',
      'Vila Gois',
      'Viviam Parque',
    ];
    return { ok: true, clusters: clusters.map((c) => ({ cluster: c, vehicleType: null })) };
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
