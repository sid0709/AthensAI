import { Injectable, Logger } from '@nestjs/common';

/**
 * Extract plain text from uploaded resume buffers (pdf / docx / txt).
 */
@Injectable()
export class ResumeTextService {
  private readonly logger = new Logger(ResumeTextService.name);

  async extract(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const lower = String(fileName || '').toLowerCase();
    try {
      if (mimeType === 'text/plain' || lower.endsWith('.txt')) {
        return buffer.toString('utf8');
      }
      if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
        const pdfParse = (await import('pdf-parse')).default as (
          data: Buffer,
        ) => Promise<{ text?: string }>;
        const result = await pdfParse(buffer);
        return result?.text || '';
      }
      if (
        mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lower.endsWith('.docx')
      ) {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result?.value || '';
      }
    } catch (err) {
      this.logger.warn(
        `Text extraction failed (${fileName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return '';
  }
}
