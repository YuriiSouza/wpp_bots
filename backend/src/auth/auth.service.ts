import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminCommonService } from '../admin-common/admin-common.service';

@Injectable()
export class AuthService {
  constructor(private readonly common: AdminCommonService) {}

  async login(
    emailRaw: string,
    passwordRaw: string,
  ): Promise<{ accessToken: string; user: Record<string, unknown> }> {
    await this.common.ensureSupportSeedData();
    const prisma = this.common.prisma as any;
    const email = String(emailRaw || '').trim().toLowerCase();
    const password = String(passwordRaw || '').trim();
    const analyst = await prisma.analyst.findUnique({
      where: { email },
      include: { hub: true },
    });

    if (!analyst || analyst.password !== password || !analyst.isActive) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const user = {
      id: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
    };

    const accessToken = this.common.createJwtToken({
      sub: analyst.id,
      name: analyst.name,
      email: analyst.email,
      role: analyst.role,
      hubId: analyst.hubId,
      hubName: analyst.hub?.name || null,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
    });

    return { accessToken, user };
  }
}
