import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

export async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Title
      doc.fontSize(20).text(data.title || 'Documento Transcrito', { align: 'center' });
      doc.moveDown();

      // Metadata Section
      if (data.metadata) {
        doc.addPage();
        doc.fontSize(16).text('Metadados (ELY)', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(data.metadata);
        doc.moveDown();
      }

      // Summary Section
      if (data.summary) {
        doc.addPage();
        doc.fontSize(16).text('Resumo Estruturado', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(data.summary);
        doc.moveDown();
      }

      // Q&A Section
      if (data.qa) {
        doc.addPage();
        doc.fontSize(16).text('Perguntas e Respostas', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(data.qa);
        doc.moveDown();
      }

      // Raw Text Section
      if (data.rawText) {
        doc.addPage();
        doc.fontSize(16).text('Texto Extraído / Transcrição Completa', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(data.rawText);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export async function generateDOCX(data) {
  const children = [];

  // Title
  children.push(
    new Paragraph({
      text: data.title || 'Documento Transcrito',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  // Helper to add section
  const addSection = (title, content) => {
    if (!content) return;
    
    // Page Break before new sections (except maybe the first one if we wanted, but let's separate them clearly)
    children.push(
      new Paragraph({
        text: "",
        pageBreakBefore: true
      })
    );

    children.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.HEADING_1,
      })
    );

    // Split content by newlines to create proper paragraphs
    const lines = content.split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        children.push(
          new Paragraph({
            children: [new TextRun(line)],
            spacing: {
              after: 200, // Spacing after paragraph
            },
          })
        );
      }
    });
  };

  if (data.metadata) addSection('Metadados (ELY)', data.metadata);
  if (data.summary) addSection('Resumo Estruturado', data.summary);
  if (data.qa) addSection('Perguntas e Respostas', data.qa);
  if (data.rawText) addSection('Texto Extraído / Transcrição Completa', data.rawText);

  const doc = new Document({
    sections: [{
      properties: {},
      children: children,
    }],
  });

  return await Packer.toBuffer(doc);
}
