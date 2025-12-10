import jsPDF from "jspdf";

type Play = {
  id: string;
  name: string;
  image: string; // Base64 data URL
};

export const generatePDF = (playbook: Play[], format: 'sheet' | 'wristband') => {
  if (playbook.length === 0) {
    alert("No plays in playbook to export!");
    return;
  }

  const isWristband = format === 'wristband';
  
  // --- CONFIGURATION ---
  // 1. WRISTBAND: 13cm x 7cm Physical Size. 
  //    We fit 8 plays (4 cols x 2 rows) per card.
  // 2. SHEET: A4 Landscape (Like Reference PDF). 
  //    We fit 24 plays (4 cols x 6 rows) per page.
  
  const COLS = 4; // Both formats use 4 columns based on your reference
  const ROWS = isWristband ? 2 : 6; 
  const CELLS_PER_PAGE = COLS * ROWS;

  // Paper Dimensions (mm)
  // Wristband: 130mm x 70mm
  // Sheet: A4 Landscape (297mm x 210mm)
  const PAGE_WIDTH = isWristband ? 130 : 297; 
  const PAGE_HEIGHT = isWristband ? 70 : 210;
  
  // Margins
  const MARGIN_X = isWristband ? 2 : 10;
  const MARGIN_Y = isWristband ? 2 : 10;
  const HEADER_HEIGHT = isWristband ? 8 : 15; // Height of the main title bar ("TEAM PLAYBOOK")
  
  // Calculate Cell Sizes
  const contentWidth = PAGE_WIDTH - (MARGIN_X * 2);
  const contentHeight = PAGE_HEIGHT - (MARGIN_Y * 2) - HEADER_HEIGHT;
  
  const cellWidth = contentWidth / COLS;
  const cellHeight = contentHeight / ROWS;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: isWristband ? [130, 70] : "a4",
  });

  playbook.forEach((play, index) => {
    const positionOnPage = index % CELLS_PER_PAGE;
    
    // --- NEW PAGE LOGIC ---
    if (positionOnPage === 0) {
      if (index > 0) doc.addPage();
      
      // Page Title Bar (Dark Gray)
      doc.setFillColor(30, 30, 30);
      doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT, "F");
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(isWristband ? 8 : 14);
      doc.setFont("helvetica", "bold");
      
      const title = isWristband ? "WRISTBAND INSERT (13x7cm)" : "OFFENSIVE CALL SHEET";
      // Center Text: Width/2, Vertical Center of Header
      doc.text(title, PAGE_WIDTH / 2, HEADER_HEIGHT / 1.5, { align: "center" });
    }

    // --- GRID CALCULATION ---
    const col = positionOnPage % COLS;
    const row = Math.floor(positionOnPage / COLS);
    
    const x = MARGIN_X + (col * cellWidth);
    const y = MARGIN_Y + HEADER_HEIGHT + (row * cellHeight);

    // 1. Draw Cell Border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellWidth, cellHeight);

    // 2. Play Header Bar (Black)
    // Scale header height based on format
    const playHeaderH = isWristband ? 5 : 7; 
    
    doc.setFillColor(0, 0, 0);
    doc.rect(x, y, cellWidth, playHeaderH, "F");
    
    // 3. Number Box (Orange)
    const numBoxW = isWristband ? 6 : 10;
    doc.setFillColor(255, 140, 0);
    doc.rect(x, y, numBoxW, playHeaderH, "F");
    
    // 4. Text (Number & Name)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(isWristband ? 6 : 9);
    
    // Number centered in orange box
    doc.text(`${index + 1}`, x + (numBoxW / 2), y + (playHeaderH / 1.5), { align: "center" });
    
    // Name
    const nameX = x + numBoxW + 2;
    // Truncate name to fit
    const maxChars = isWristband ? 15 : 25;
    const displayName = play.name.length > maxChars 
      ? play.name.substring(0, maxChars) + ".." 
      : play.name;
      
    doc.text(displayName.toUpperCase(), nameX, y + (playHeaderH / 1.5));

    // 5. Image (Maximize fit)
    const pad = 1; 
    const imgX = x + pad;
    const imgY = y + playHeaderH + pad;
    const imgW = cellWidth - (pad * 2);
    const imgH = cellHeight - playHeaderH - (pad * 2);

    try {
        doc.addImage(play.image, "PNG", imgX, imgY, imgW, imgH, undefined, 'FAST');
    } catch (e) {
        console.error("Error adding image to PDF", e);
    }
  });

  doc.save(isWristband ? "wristband_13x7.pdf" : "playcall_sheet.pdf");
};