import jsPDF from "jspdf";

type Play = {
  id: string;
  name: string;
  image?: string; // optional: built-in sample plays have vectors but no snapshot
};

// Helper to convert remote URL to Base64 for PDF embedding
const getBase64FromUrl = async (url: string): Promise<string> => {
  const data = await fetch(url);
  const blob = await data.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = reader.result;
      resolve(base64data as string);
    };
  });
};

export const generatePDF = async (playbook: Play[], format: 'sheet' | 'wristband') => {
  if (playbook.length === 0) {
    alert("No plays in playbook to export!");
    return;
  }

  const isWristband = format === 'wristband';

  // --- DIMENSIONS & CONFIGURATION (in mm) ---
  const PAGE_WIDTH = isWristband ? 130 : 210;
  const PAGE_HEIGHT = isWristband ? 70 : 297;

  // Grid Configuration
  // Sheet: 4 cols x 6 rows = 24 plays (unlimited pages)
  // Wristband: 4 cols x 3 rows = 12 plays base, MAX 3 pages.
  // Overflow is divided as evenly as possible across exactly 3 pages
  // by growing the row count (cells shrink to fit).
  const COLS = 4;
  const BASE_WB_CELLS = 12;
  const MAX_WB_PAGES = 3;

  let wbPageSizes: number[] = [];
  let ROWS: number;
  if (!isWristband) {
    ROWS = 6;
  } else {
    const total = playbook.length;
    const pageCount = Math.min(MAX_WB_PAGES, Math.max(1, Math.ceil(total / BASE_WB_CELLS)));
    const baseSize = Math.floor(total / pageCount);
    const remainder = total % pageCount;
    // First `remainder` pages get one extra play (e.g. 40 plays -> 14/13/13)
    wbPageSizes = Array.from({ length: pageCount }, (_, i) => baseSize + (i < remainder ? 1 : 0));
    ROWS = Math.max(3, Math.ceil(wbPageSizes[0] / COLS));
  }
  const CELLS_PER_PAGE = COLS * ROWS;

  // When the wristband grid grows past 4x3, shrink header/fonts proportionally
  const density = isWristband ? Math.min(1, 3 / ROWS) : 1;

  const MARGIN_X = isWristband ? 2 : 10;
  const MARGIN_TOP = isWristband ? 2 : 20;
  const MARGIN_BOTTOM = isWristband ? 2 : 10;

  const contentWidth = PAGE_WIDTH - (MARGIN_X * 2);
  const contentHeight = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

  const cellWidth = contentWidth / COLS;
  const cellHeight = contentHeight / ROWS;

  const doc = new jsPDF({
    orientation: isWristband ? "landscape" : "portrait",
    unit: "mm",
    format: isWristband ? [130, 70] : "a4",
  });

  // Load all images first (plays without a snapshot export headers only)
  const playsWithData = await Promise.all(playbook.map(async (p) => {
    if (!p.image) return { ...p, imageData: null };
    try {
        const base64 = await getBase64FromUrl(p.image);
        return { ...p, imageData: base64 };
    } catch (e) {
        console.error("Failed to load image for PDF", e);
        return { ...p, imageData: null };
    }
  }));

  // Draw one play cell. globalIndex keeps numbering consistent (1..N) across pages.
  const drawPlayCell = (play: (typeof playsWithData)[number], globalIndex: number, col: number, row: number) => {
    const x = MARGIN_X + (col * cellWidth);
    const y = MARGIN_TOP + (row * cellHeight);

    // 1. Cell Border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellWidth, cellHeight);

    // 2. Header Strip (floored so text never overflows the strip at high density)
    const cellHeaderHeight = isWristband
      ? Math.max(2.4, 4.5 * density)
      : 7;
    doc.setFillColor(51, 51, 51);
    doc.rect(x, y, cellWidth, cellHeaderHeight, "F");

    // 3. Number Box
    const numBoxWidth = isWristband ? 6 : 8;
    doc.setFillColor(255, 140, 0);
    doc.rect(x, y, numBoxWidth, cellHeaderHeight, "F");

    // 4. Text — exactly vertically centered (no fixed-mm offsets, which
    // break centering once the header shrinks at high play counts)
    const headerMidY = y + cellHeaderHeight / 2;
    doc.setTextColor(255, 255, 255);

    doc.setFontSize(isWristband ? Math.max(4, 7 * density) : 9);
    doc.setFont("helvetica", "bold");
    doc.text(`${globalIndex + 1}`, x + (numBoxWidth / 2), headerMidY, { align: "center", baseline: "middle" });

    const nameX = x + numBoxWidth + 1.5;
    doc.setFontSize(isWristband ? Math.max(4, 5.5 * density) : 7);
    doc.setFont("helvetica", "bold");

    const maxNameChar = isWristband ? 18 : 22;
    const displayName = play.name.length > maxNameChar
      ? play.name.substring(0, maxNameChar) + ".."
      : play.name;

    doc.text(displayName.toUpperCase(), nameX, headerMidY, { baseline: "middle" });

    // 5. Image (skipped if the cell is too short to fit one — prevents
    // addImage errors in extreme high-density scenarios)
    if (play.imageData) {
        const imgAreaX = x + 0.5;
        const imgAreaY = y + cellHeaderHeight + 0.5;
        const imgAreaW = cellWidth - 1;
        const imgAreaH = cellHeight - cellHeaderHeight - 1;

        if (imgAreaW > 2 && imgAreaH > 2) {
        try {
            const imgProps = doc.getImageProperties(play.imageData);
            const imgRatio = imgProps.width / imgProps.height;
            const boxRatio = imgAreaW / imgAreaH;

            let finalW, finalH, finalX, finalY;

            if (imgRatio > boxRatio) {
                finalW = imgAreaW;
                finalH = imgAreaW / imgRatio;
                finalX = imgAreaX;
                finalY = imgAreaY + (imgAreaH - finalH) / 2;
            } else {
                finalH = imgAreaH;
                finalW = imgAreaH * imgRatio;
                finalY = imgAreaY;
                finalX = imgAreaX + (imgAreaW - finalW) / 2;
            }

            doc.addImage(play.imageData, "PNG", finalX, finalY, finalW, finalH, undefined, 'FAST');
        } catch (e) {
            console.error("Error adding image to PDF", e);
        }
        }
    }
  };

  if (isWristband) {
    // Max 3 pages, plays split as evenly as possible across them
    let cursor = 0;
    wbPageSizes.forEach((size, p) => {
      if (p > 0) doc.addPage();
      for (let j = 0; j < size; j++) {
        const play = playsWithData[cursor];
        drawPlayCell(play, cursor, j % COLS, Math.floor(j / COLS));
        cursor++;
      }
    });
    if (playbook.length > BASE_WB_CELLS * MAX_WB_PAGES) {
      console.info(
        `Wristband capped at ${MAX_WB_PAGES} pages: ${playbook.length} plays fit as ` +
        wbPageSizes.join("/") + " per page."
      );
    }
  } else {
    playsWithData.forEach((play, index) => {
      const positionOnPage = index % CELLS_PER_PAGE;

      if (positionOnPage === 0) {
        if (index > 0) doc.addPage();

        doc.setTextColor(40, 40, 40);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("TEAM PLAYBOOK", MARGIN_X, 10);

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Offense", MARGIN_X, 15);

        const dateStr = new Date().toLocaleDateString();
        doc.setFontSize(8);
        doc.text(dateStr, PAGE_WIDTH - MARGIN_X, 10, { align: "right" });
      }

      const col = positionOnPage % COLS;
      const row = Math.floor(positionOnPage / COLS);

      drawPlayCell(play, index, col, row);
    });
  }

  doc.save(isWristband ? `wristband_${playbook.length}play.pdf` : "playbook_a4.pdf");
};
