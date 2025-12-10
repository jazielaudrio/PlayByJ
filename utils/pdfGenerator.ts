import jsPDF from "jspdf";

type Play = {
  id: string;
  name: string;
  image: string; // URL from Firebase Storage
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
  // Sheet: 4 cols x 6 rows = 24 plays
  // Wristband: 4 cols x 3 rows = 12 plays
  const COLS = 4;
  const ROWS = isWristband ? 3 : 6; 
  const CELLS_PER_PAGE = COLS * ROWS;

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

  // Load all images first
  const playsWithData = await Promise.all(playbook.map(async (p) => {
    try {
        const base64 = await getBase64FromUrl(p.image);
        return { ...p, imageData: base64 };
    } catch (e) {
        console.error("Failed to load image for PDF", e);
        return { ...p, imageData: null };
    }
  }));

  playsWithData.forEach((play, index) => {
    const positionOnPage = index % CELLS_PER_PAGE;
    
    if (positionOnPage === 0) {
      if (index > 0) doc.addPage();
      
      if (!isWristband) {
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
    }

    const col = positionOnPage % COLS;
    const row = Math.floor(positionOnPage / COLS);
    
    const x = MARGIN_X + (col * cellWidth);
    const y = MARGIN_TOP + (row * cellHeight);

    // 1. Cell Border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellWidth, cellHeight);

    // 2. Header Strip
    const cellHeaderHeight = isWristband ? 4.5 : 7; 
    doc.setFillColor(51, 51, 51); 
    doc.rect(x, y, cellWidth, cellHeaderHeight, "F");
    
    // 3. Number Box
    const numBoxWidth = isWristband ? 6 : 8;
    doc.setFillColor(255, 140, 0); 
    doc.rect(x, y, numBoxWidth, cellHeaderHeight, "F");
    
    // 4. Text
    doc.setTextColor(255, 255, 255); 
    
    doc.setFontSize(isWristband ? 7 : 9);
    doc.setFont("helvetica", "bold");
    doc.text(`${index + 1}`, x + (numBoxWidth / 2), y + (cellHeaderHeight / 2) + 1.2, { align: "center", baseline: "middle" });
    
    const nameX = x + numBoxWidth + 1.5;
    doc.setFontSize(isWristband ? 5.5 : 7);
    doc.setFont("helvetica", "bold");
    
    const maxNameChar = isWristband ? 18 : 22;
    const displayName = play.name.length > maxNameChar 
      ? play.name.substring(0, maxNameChar) + ".." 
      : play.name;
      
    doc.text(displayName.toUpperCase(), nameX, y + (cellHeaderHeight / 2) + 1, { baseline: "middle" });

    // 5. Image
    if (play.imageData) {
        const imgAreaX = x + 0.5;
        const imgAreaY = y + cellHeaderHeight + 0.5;
        const imgAreaW = cellWidth - 1;
        const imgAreaH = cellHeight - cellHeaderHeight - 1;

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
  });

  doc.save(isWristband ? "wristband_12play.pdf" : "playbook_a4.pdf");
};