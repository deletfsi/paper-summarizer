import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFName, PDFDict, PDFNumber, PDFStream, PDFArray } from 'pdf-lib';
import { logger } from './logger';

export interface ExtractedImage {
  pageNumber: number;
  imageIndex: number;
  width: number;
  height: number;
  format: string;
  filePath: string;
}

function pdfValueToNumber(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'function') return value();
  return 0;
}

/**
 * Extract images from a PDF file and save them to the specified directory.
 * @param pdfPath Path to the PDF file
 * @param outputDir Directory to save extracted images
 * @returns Array of extracted image metadata
 */
export async function extractImages(pdfPath: string, outputDir: string): Promise<ExtractedImage[]> {
  logger.info(`Starting image extraction from PDF: ${pdfPath}`);

  // Validate PDF path
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    logger.info(`Created output directory: ${outputDir}`);
  }

  // Read the PDF file
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const extractedImages: ExtractedImage[] = [];

  logger.info(`Processing ${pages.length} pages`);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageNumber = pageIndex + 1;

    try {
      // Get page resources
      const pageResources = page.node.lookup(PDFName.of('Resources'), PDFDict);

      if (!pageResources) {
        continue;
      }

      // Get XObject dictionary (contains images)
      const xObjects = pageResources.lookup(PDFName.of('XObject'), PDFDict);

      if (!xObjects) {
        continue;
      }

      const xObjectNames = xObjects.keys();
      let imageIndex = 0;

      for (const name of xObjectNames) {
        try {
          const xObject = xObjects.lookup(name);

          if (!(xObject instanceof PDFStream)) {
            continue;
          }

          const subtype = xObject.dict.lookup(PDFName.of('Subtype'));
          if (subtype && subtype.toString() !== '/Image') {
            continue;
          }

          // Get image properties
          const widthObj = xObject.dict.lookup(PDFName.of('Width'));
          const heightObj = xObject.dict.lookup(PDFName.of('Height'));
          const width = pdfValueToNumber(widthObj);
          const height = pdfValueToNumber(heightObj);

          // Determine format based on filter
          const filter = xObject.dict.lookup(PDFName.of('Filter'));
          let format = 'png';

          if (filter) {
            const filterStr = filter.toString();
            if (filterStr.includes('DCTDecode')) {
              format = 'jpeg';
            } else if (filterStr.includes('JPXDecode')) {
              format = 'jpeg';
            }
          }

          // Get image data - access the raw bytes
          const imageData = xObject.getContents();

          if (!imageData || imageData.length === 0) {
            logger.warn(`No image data found for ${name} on page ${pageNumber}`);
            continue;
          }

          // Generate filename
          const imgIndexOnPage = imageIndex + 1;
          const filename = `page${pageNumber}_image${imgIndexOnPage}.${format}`;
          const filePath = path.join(outputDir, filename);

          // Write image to file
          fs.writeFileSync(filePath, Buffer.from(imageData));

          const extractedImage: ExtractedImage = {
            pageNumber,
            imageIndex: imgIndexOnPage,
            width,
            height,
            format,
            filePath,
          };

          extractedImages.push(extractedImage);
          logger.debug(`Extracted image: ${filename} (${width}x${height})`);
          imageIndex++;
        } catch (error) {
          logger.warn(`Failed to extract image ${name} from page ${pageNumber}: ${error}`);
        }
      }

      if (imageIndex > 0) {
        logger.info(`Found ${imageIndex} images on page ${pageNumber}`);
      }
    } catch (error) {
      logger.warn(`Failed to process page ${pageNumber}: ${error}`);
    }
  }

  logger.success(`Extracted ${extractedImages.length} images from PDF`);
  return extractedImages;
}

/**
 * Get the count of images in a PDF without extracting them.
 * @param pdfPath Path to the PDF file
 * @returns Total number of images
 */
export async function getImageCount(pdfPath: string): Promise<number> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  let totalImages = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    try {
      const pageResources = page.node.lookup(PDFName.of('Resources'), PDFDict);

      if (!pageResources) {
        continue;
      }

      const xObjects = pageResources.lookup(PDFName.of('XObject'), PDFDict);

      if (!xObjects) {
        continue;
      }

      const xObjectNames = xObjects.keys();

      for (const name of xObjectNames) {
        const xObject = xObjects.lookup(name);

        if (!(xObject instanceof PDFStream)) {
          continue;
        }

        const subtype = xObject.dict.lookup(PDFName.of('Subtype'));
        if (subtype && subtype.toString() === '/Image') {
          totalImages++;
        }
      }
    } catch {
      // Ignore errors for individual pages
    }
  }

  return totalImages;
}
