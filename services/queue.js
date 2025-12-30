import { EventEmitter } from 'events';
import { processVideoFile } from './videoTranscription.js';
import { downloadTranscript } from '../downloadTranscript.js';

class TranscriptionQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.processing = false;
    this.currentJob = null;
  }

  /**
   * Adiciona um job à fila
   * @param {Object} job - { type: 'upload' | 'url', data: { filePath, fileName } | { videoUrl }, jobId }
   * @returns {string} jobId
   */
  addJob(job) {
    const jobId = job.jobId || `job-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    const queueJob = {
      id: jobId,
      type: job.type, // 'upload' ou 'url'
      data: job.data,
      status: 'pending',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null
    };

    this.queue.push(queueJob);

    // Emitir evento de job adicionado
    this.emit('jobAdded', queueJob);

    // Iniciar processamento se não estiver processando
    if (!this.processing) {
      this.processNext();
    }

    return jobId;
  }

  /**
   * Processa o próximo job da fila
   */
  async processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const job = this.queue.find(j => j.status === 'pending');

    if (!job) {
      this.processing = false;
      return;
    }

    this.currentJob = job;
    job.status = 'processing';
    job.startedAt = new Date();
    
    this.emit('jobStarted', job);

    try {
      let result;

      if (job.type === 'upload') {
        const { filePath, fileName } = job.data;
        result = await processVideoFile(filePath, fileName);
      } else if (job.type === 'url') {
        const { videoUrl } = job.data;
        result = await downloadTranscript(videoUrl);
      } else {
        throw new Error(`Tipo de job desconhecido: ${job.type}`);
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;
      
      this.emit('jobCompleted', job);

    } catch (error) {
      job.status = 'error';
      job.completedAt = new Date();
      job.error = error.message;
      
      console.error(`❌ Erro no job ${job.id}:`, error.message);
      this.emit('jobError', job, error);
    } finally {
      this.currentJob = null;
      this.processing = false;
      
      // Processar próximo job
      setTimeout(() => {
        this.processNext();
      }, 1000); // Pequeno delay entre jobs
    }
  }

  /**
   * Retorna o status de um job específico
   */
  getJobStatus(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result ? {
        success: job.result.success,
        videoId: job.result.videoId,
        message: job.result.message
      } : null
    };
  }

  /**
   * Retorna o status de todos os jobs
   */
  getAllJobsStatus() {
    return this.queue.map(job => ({
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      hasResult: !!job.result
    }));
  }

  /**
   * Retorna informações sobre a fila
   */
  getQueueInfo() {
    const pending = this.queue.filter(j => j.status === 'pending').length;
    const processing = this.queue.filter(j => j.status === 'processing').length;
    const completed = this.queue.filter(j => j.status === 'completed').length;
    const error = this.queue.filter(j => j.status === 'error').length;

    return {
      total: this.queue.length,
      pending,
      processing,
      completed,
      error,
      currentJob: this.currentJob ? {
        id: this.currentJob.id,
        type: this.currentJob.type,
        startedAt: this.currentJob.startedAt
      } : null
    };
  }

  /**
   * Remove jobs antigos (opcional, para limpeza)
   */
  cleanup(olderThanHours = 24) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - olderThanHours);

    const initialLength = this.queue.length;
    this.queue = this.queue.filter(job => {
      if (job.completedAt && job.completedAt < cutoff) {
        return false;
      }
      return true;
    });

    const removed = initialLength - this.queue.length;
    return removed;
  }
}

// Singleton
const queue = new TranscriptionQueue();

export default queue;

