import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.analyst.findUnique({ where: { email: 'admin@admin.com' } });
  if (existing) {
    console.log('Usuario ja existe:', existing.email);
    return;
  }

  const analyst = await prisma.analyst.create({
    data: {
      id: Math.random().toString(36).slice(2),
      name: 'Admin',
      email: 'admin@admin.com',
      password: 'admin123',
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Usuario criado:', analyst.email, '| Senha: admin123');
}

main().catch(console.error).finally(() => prisma.$disconnect());
