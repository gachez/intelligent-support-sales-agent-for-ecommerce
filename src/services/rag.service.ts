const pdfParse = require("pdf-parse");

export class RAGService {
  /**
   * Extracts text from an uploaded file buffer.
   * Handles both .txt and .pdf files.
   */
  async extractTextFromFile(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === "application/pdf") {
      try {
        const data = await pdfParse(buffer);
        // Clean up the text by removing excessive newlines and spaces
        return data.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      } catch (error) {
        throw new Error("Failed to parse PDF document.");
      }
    } 
    
    if (mimetype === "text/plain") {
      return buffer.toString("utf-8").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    }

    throw new Error("Unsupported file format. Please upload a PDF or TXT file.");
  }
}