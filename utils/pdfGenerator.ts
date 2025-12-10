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
  
  // --- DIMENSIONS & CONFIGURATION (in mm) ---
  // A4 Portrait: 210mm x 297mm
  // Wristband: 130mm x 70mm (Standard Wristband Insert Size)
  const PAGE_WIDTH = isWristband ? 130 : 210; 
  const PAGE_HEIGHT = isWristband ? 70 : 297;
  
  // Grid Configuration
  // Sheet: 4 cols x 6 rows = 24 plays
  // Wristband: 4 cols x 3 rows = 12 plays
  const COLS = 4;
  const ROWS = isWristband ? 3 : 6; 
  const CELLS_PER_PAGE = COLS * ROWS;

  // Margins (Tight margins for wristband to maximize space)
  const MARGIN_X = isWristband ? 2 : 10;
  const MARGIN_TOP = isWristband ? 2 : 20; 
  const MARGIN_BOTTOM = isWristband ? 2 : 10;
  
  // Calculate Cell Sizes
  const contentWidth = PAGE_WIDTH - (MARGIN_X * 2);
  const contentHeight = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  
  const cellWidth = contentWidth / COLS;
  const cellHeight = contentHeight / ROWS;

  // Initialize PDF
  const doc = new jsPDF({
    orientation: isWristband ? "landscape" : "portrait",
    unit: "mm",
    format: isWristband ? [130, 70] : "a4",
  });

  playbook.forEach((play, index) => {
    const positionOnPage = index % CELLS_PER_PAGE;
    
    // --- NEW PAGE HEADER ---
    if (positionOnPage === 0) {
      if (index > 0) doc.addPage();
      
      if (!isWristband) {
        // Main Title for Sheet
        doc.setTextColor(40, 40, 40);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("TEAM PLAYBOOK", MARGIN_X, 10); 
        
        // Subtitle
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Offense", MARGIN_X, 15);

        // Date (Top Right)
        const dateStr = new Date().toLocaleDateString();
        doc.setFontSize(8);
        doc.text(dateStr, PAGE_WIDTH - MARGIN_X, 10, { align: "right" });
      }
    }

    // --- CELL POSITION CALCULATION ---
    const col = positionOnPage % COLS;
    const row = Math.floor(positionOnPage / COLS);
    
    const x = MARGIN_X + (col * cellWidth);
    const y = MARGIN_TOP + (row * cellHeight);

    // 1. Cell Border (Thin Grey)
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellWidth, cellHeight);

    // 2. PLAY HEADER STRIP (Dark Grey Bar)
    // Slightly smaller header for wristband to save vertical space for the diagram
    const cellHeaderHeight = isWristband ? 4.5 : 7; 
    
    doc.setFillColor(51, 51, 51); // Dark Grey #333333
    doc.rect(x, y, cellWidth, cellHeaderHeight, "F");
    
    // 3. NUMBER BOX (Orange)
    const numBoxWidth = isWristband ? 6 : 8;
    doc.setFillColor(255, 140, 0); // Orange #FF8C00
    doc.rect(x, y, numBoxWidth, cellHeaderHeight, "F");
    
    // 4. TEXT (Number & Name)
    doc.setTextColor(255, 255, 255); // White
    
    // Number (Centered in orange box)
    doc.setFontSize(isWristband ? 7 : 9);
    doc.setFont("helvetica", "bold");
    // Adjustment (+1.5 or +1.2) centers text vertically in the bar
    doc.text(`${index + 1}`, x + (numBoxWidth / 2), y + (cellHeaderHeight / 2) + 1.2, { align: "center", baseline: "middle" });
    
    // Play Name (Left aligned in grey bar)
    const nameX = x + numBoxWidth + 1.5;
    // Slightly smaller font for wristband names to fit 12 grid
    doc.setFontSize(isWristband ? 5.5 : 7);
    doc.setFont("helvetica", "bold");
    
    // Truncate name to fit
    const maxNameChar = isWristband ? 18 : 22;
    const displayName = play.name.length > maxNameChar 
      ? play.name.substring(0, maxNameChar) + ".." 
      : play.name;
      
    doc.text(displayName.toUpperCase(), nameX, y + (cellHeaderHeight / 2) + 1, { baseline: "middle" });

    // 5. PLAY IMAGE (Proportional Fit / Contain)
    const imgAreaX = x + 0.5;
    const imgAreaY = y + cellHeaderHeight + 0.5;
    const imgAreaW = cellWidth - 1;
    const imgAreaH = cellHeight - cellHeaderHeight - 1;

    try {
        // Calculate aspect ratios to fit image without stretching
        const imgProps = doc.getImageProperties(play.image);
        const imgRatio = imgProps.width / imgProps.height;
        const boxRatio = imgAreaW / imgAreaH;

        let finalW, finalH, finalX, finalY;

        if (imgRatio > boxRatio) {
            // Image is wider than box -> Fit to Width
            finalW = imgAreaW;
            finalH = imgAreaW / imgRatio;
            finalX = imgAreaX;
            finalY = imgAreaY + (imgAreaH - finalH) / 2; // Center Vertically
        } else {
            // Image is taller than box -> Fit to Height
            finalH = imgAreaH;
            finalW = imgAreaH * imgRatio;
            finalY = imgAreaY;
            finalX = imgAreaX + (imgAreaW - finalW) / 2; // Center Horizontally
        }

        doc.addImage(play.image, "PNG", finalX, finalY, finalW, finalH, undefined, 'FAST');
    } catch (e) {
        console.error("Error adding image to PDF", e);
    }
  });

  doc.save(isWristband ? "wristband_12play.pdf" : "playbook_a4.pdf");
};