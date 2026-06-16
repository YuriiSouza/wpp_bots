import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Wrapper de pg_advisory_lock para coordenar concorrência sem Redis.
 * Locks são identificados por uma string (qualquer label), convertida em BIGINT
 * via hash SHA-256 truncado para caber em int8 do Postgres.
 *
 * - tryLock: pg_try_advisory_lock — retorna imediatamente; útil pra evitar dois
 *   syncs concorrentes.
 * - withLock: pega/solta o lock em volta de uma função.
 * - withTransactionLock: variant que pega lock dentro de uma transação
 *   (auto-release no commit/rollback).
 */
@Injectable()
export class PgLockService {
  constructor(private readonly prisma: PrismaService) {}

  private keyToInt(label: string): bigint {
    const digest = createHash('sha256').update(label).digest();
    // BIGINT do Postgres é signed int64; pega 8 bytes e converte.
    const value = digest.readBigInt64BE(0);
    return value;
  }

  async tryLock(label: string): Promise<boolean> {
    const key = this.keyToInt(label);
    const rows = await this.prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
      SELECT pg_try_advisory_lock(${key}) AS "pg_try_advisory_lock"
    `;
    return !!rows[0]?.pg_try_advisory_lock;
  }

  async unlock(label: string): Promise<void> {
    const key = this.keyToInt(label);
    await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${key})`;
  }

  async withLock<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const ok = await this.tryLock(label);
    if (!ok) return null;
    try {
      return await fn();
    } finally {
      await this.unlock(label);
    }
  }

  /**
   * Usa pg_advisory_xact_lock dentro de uma transação — o lock é liberado
   * automaticamente no commit/rollback. Use para garantir serialização de uma
   * operação curta (ex: promover próximo da fila).
   */
  async withTransactionLock<T>(
    label: string,
    fn: (tx: any) => Promise<T>,
  ): Promise<T> {
    const key = this.keyToInt(label);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`;
      return fn(tx);
    });
  }
}
