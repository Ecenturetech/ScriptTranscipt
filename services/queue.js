import { EventEmitter } from 'events';
import { processVideoFile } from './videoTranscription.js';
import { processPDFFile } from './pdfProcessing.js';
import { processScormContent } from './scormProcessing.js';
import { downloadTranscript } from '../downloadTranscript.js';

class TranscriptionQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.processing = false;
    this.currentJob = null;
  }

  addJob(job) {
    const jobId = job.jobId || `job-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    const queueJob = {
      id: jobId,
      type: job.type,
      data: job.data,
      status: 'pending',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null
    };

    this.queue.push(queueJob);

    this.emit('jobAdded', queueJob);
    if (!this.processing) {
      setImmediate(() => {
        this.processNext();
      });
    }

    return jobId;
  }

  async processNext() {
    if (this.processing) {
      return;
    }

    const job = this.queue.find(j => j.status === 'pending');

    if (!job) {
      this.processing = false;
      return;
    }

    this.processing = true;
    this.currentJob = job;
    job.status = 'processing';
    job.startedAt = new Date();
    
    this.emit('jobStarted', job);

    console.log(`🔄 Processando job ${job.id} (${job.type}) - ${this.queue.filter(j => j.status === 'pending').length} pendente(s)`);

    try {
      let result;

      if (job.type === 'upload') {
        const { filePath, fileName } = job.data;
        result = await processVideoFile(filePath, fileName);
      } else if (job.type === 'url') {
        const { videoUrl } = job.data;
        result = await downloadTranscript(videoUrl);
      } else if (job.type === 'pdf') {
        const { filePath, fileName, forceVision } = job.data;
        result = await processPDFFile(filePath, fileName, forceVision);
      } else if (job.type === 'scorm') {
        const { scormId, scormName, coursePath } = job.data;
        result = await processScormContent(scormId, scormName, coursePath);
      } else {
        throw new Error(`Tipo de job desconhecido: ${job.type}`);
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;
      
      console.log(`✅ Job ${job.id} concluído com sucesso`);
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
      
      setImmediate(() => {
        this.processNext();
      });
    }
  }

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
        pdfId: job.result.pdfId,
        message: job.result.message
      } : null
    };
  }

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

const queue = new TranscriptionQueue();

export default queue;

