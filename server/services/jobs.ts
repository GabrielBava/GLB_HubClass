import type { FastifyBaseLogger } from "fastify";

/**
 * Fila simples em processo para tarefas pesadas (processamento de documentos).
 * Executa uma tarefa por vez. Para vários servidores, substituir por uma fila
 * dedicada (ex.: BullMQ/SQS) mantendo a mesma interface.
 */
export class JobQueue {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly log: FastifyBaseLogger) {}

  enqueue(name: string, task: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = this.chain.then(async () => {
      try {
        await task();
      } catch (err) {
        this.log.error({ err, job: name }, "falha na tarefa em segundo plano");
      } finally {
        this.pending--;
      }
    });
    this.chain = run;
    return run;
  }

  get size() {
    return this.pending;
  }

  /** Aguarda todas as tarefas pendentes (usado em testes e no desligamento). */
  async drain(): Promise<void> {
    while (this.pending > 0) await this.chain;
  }
}
