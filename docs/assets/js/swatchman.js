const DEFAULT_RAMP = 20;
const MIN_SWATCHES = 1;
const MAX_SWATCHES = 16;
const MAX_ROWS = 16;
const DRAG_PIXELS_PER_STEP = 3;
const DRAG_START_THRESHOLD = 4;

// Palette is a list of rows; every row has the same number of colors
const palette = [[
    [0, 100, 100],     // Red
    [30, 100, 100],    // Orange
    [60, 100, 100],    // Yellow
    [120, 100, 100],   // Green
    [180, 100, 100],   // Cyan
    [240, 100, 100],   // Blue
    [270, 100, 100],   // Purple
    [330, 100, 100]    // Magenta
]];

const SHEET_CHANNELS = [
    { label: 'H', max: 360 },
    { label: 'S', max: 100 },
    { label: 'B', max: 100 }
];

const hueInput = document.getElementById('hueInput');
const saturationInput = document.getElementById('saturationInput');
const brightnessInput = document.getElementById('brightnessInput');
const swatchContainer = document.getElementById('swatchContainer');
const addSwatchButton = document.getElementById('addSwatchButton');
const removeSwatchButton = document.getElementById('removeSwatchButton');
const addRowButton = document.getElementById('addRowButton');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const rampButton = document.getElementById('rampButton');
const rampInput = document.getElementById('rampInput');
const rampResetSV = document.getElementById('rampResetSV');
const numRowsInput = document.getElementById('numRows');
const hueShiftInput = document.getElementById('hueShift');
const desaturationFlipButton = document.getElementById('desaturationFlip');
const desaturationFactorInput = document.getElementById('desaturationFactor');
const saveButton = document.getElementById('saveButton');
const loadButton = document.getElementById('loadButton');
const loadInput = document.getElementById('loadInput');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Each history entry is a tiny image: one pixel per swatch, one image row per palette row
const history = [];

// Save / load palette as an image
const MAX_IMAGE_SIZE = 16;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/bmp', 'image/gif'];

let isUpdatingFromWheel = false;
let isUpdatingFromInputs = false;
let activeRow = 0;
let activeSwatchIndex = 0;
let sheetInputs = [];
let sheetRow = -1;
let isUpdatingFromSheet = false;
let historyIndex = -1;
let historyDirty = false;

function enableDragScrub(input) {
    input.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const startX = event.clientX;
        const startY = event.clientY;
        const startValue = parseFloat(input.value) || 0;
        let dragging = false;

        let shiftAmountLarge = max > 10 ? 1 : 0.1;
        let shiftAmountSmall = max > 10 ? 0.2 : 0.01;
        let stepAmount = parseFloat(input.step);

        const onMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (!dragging) {
                if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) return;
                dragging = true;
                input.setPointerCapture(event.pointerId);
                document.body.classList.add('scrubbing');
                window.getSelection().removeAllRanges();
            }
            const fine = moveEvent.shiftKey ? shiftAmountSmall : shiftAmountLarge;
            let delta = ((dx - dy) / DRAG_PIXELS_PER_STEP) * fine;
            let next = Math.max(min, Math.min(max, startValue + delta));
            if (stepAmount == 1) {
                next = Math.round(next);
            }

            if (String(next) !== input.value) {
                input.value = next;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        };

        const onUp = () => {
            input.removeEventListener('pointermove', onMove);
            input.removeEventListener('pointerup', onUp);
            input.removeEventListener('pointercancel', onUp);
            if (dragging) {
                document.body.classList.remove('scrubbing');
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        };

        input.addEventListener('pointermove', onMove);
        input.addEventListener('pointerup', onUp);
        input.addEventListener('pointercancel', onUp);
    });
}

function hsvToHex(h, s, v) {
    s /= 100;
    v /= 100;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r, g, b;
    
    if (h >= 0 && h < 60) {
        r = c;
        g = x;
        b = 0;
    } else if (h >= 60 && h < 120) {
        r = x;
        g = c;
        b = 0;
    } else if (h >= 120 && h < 180) {
        r = 0;
        g = c;
        b = x;
    } else if (h >= 180 && h < 240) {
        r = 0;
        g = x;
        b = c;
    } else if (h >= 240 && h < 300) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }
    
    const toHex = (val) => {
        return Math.round((val + m) * 255).toString(16).padStart(2, '0');
    };
    
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = 60 * (((g - b) / d + 6) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
    }
    return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}

function capturePaletteImage() {
    const canvas = document.createElement('canvas');
    canvas.width = palette[0].length;
    canvas.height = palette.length;
    const ctx = canvas.getContext('2d');
    palette.forEach((row, y) => {
        row.forEach((hsv, x) => {
            ctx.fillStyle = hsvToHex(hsv[0], hsv[1], hsv[2]);
            ctx.fillRect(x, y, 1, 1);
        });
    });
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function sameImage(a, b) {
    return a.width === b.width && a.height === b.height && a.data.every((value, i) => value === b.data[i]);
}

function commitPendingEdit() {
    if (!historyDirty) return;
    historyDirty = false;
    recordHistory();
}

function recordHistory() {
    const image = capturePaletteImage();
    if (historyIndex >= 0 && sameImage(history[historyIndex], image)) return;
    history.length = historyIndex + 1;
    history.push(image);
    historyIndex = history.length - 1;
    updateHistoryButtons();
}

function restoreHistory(index) {
    historyIndex = index;
    historyDirty = false;
    const { data, width, height } = history[index];
    palette.length = height;
    for (let y = 0; y < height; y++) {
        palette[y] = [];
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            palette[y][x] = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
        }
    }
    activeRow = Math.min(activeRow, height - 1);
    activeSwatchIndex = Math.min(activeSwatchIndex, width - 1);
    createSwatchSquares();
    selectSwatch(activeRow, activeSwatchIndex);
    updateHistoryButtons();
}

function updateSwatchCountButtons() {
    addSwatchButton.disabled = palette[0].length >= MAX_SWATCHES;
    removeSwatchButton.disabled = palette[0].length <= MIN_SWATCHES;
    addRowButton.disabled = palette.length >= MAX_ROWS;
}

function rebuildAfterStructureChange() {
    createSwatchSquares();
    selectSwatch(activeRow, activeSwatchIndex);
    recordHistory();
}

function addSwatch() {
    if (palette[0].length >= MAX_SWATCHES) return;
    commitPendingEdit();
    palette.forEach(row => row.push([...row[row.length - 1]]));
    activeSwatchIndex = palette[0].length - 1;
    rebuildAfterStructureChange();
}

function removeSwatch() {
    if (palette[0].length <= MIN_SWATCHES) return;
    commitPendingEdit();
    palette.forEach(row => row.pop());
    activeSwatchIndex = Math.min(activeSwatchIndex, palette[0].length - 1);
    rebuildAfterStructureChange();
}

function addRow() {
    if (palette.length >= MAX_ROWS) return;
    commitPendingEdit();
    palette.push(palette[palette.length - 1].map(hsv => [...hsv]));
    rebuildAfterStructureChange();
}

function addRows() {
    let numRows = Math.round(numRowsInput.value)
    let hueShift = Math.round(hueShiftInput.value);

    if (palette.length + numRows > MAX_ROWS) {
        numRows = MAX_ROWS - palette.length;
    }
    if (numRows <= 0) {
        return;
    }
    commitPendingEdit();
    for (let i = 0; i < numRows; ++i) {
        let newRow = palette[palette.length - 1].map(hsv => [...hsv]);
        for (let j = 0; j < newRow.length; ++j) {
            newRow[j][0] = (newRow[j][0] + hueShift + 360) % 360;
        }
        palette.push(newRow);
    }
    
    rebuildAfterStructureChange();
}

function autoSetHueShift() {
    let numRows = Math.round(numRowsInput.value)
    if (numRows < 1) {
        numRows = 1;
    } else if (numRows + palette.length > MAX_ROWS) {
        numRows = MAX_ROWS - palette.length;
    }
    if (numRows > 1) {
        addRowButton.textContent = "Add Rows";
    } else {
        addRowButton.textContent = "Add Row";
    }
    numRowsInput.value = numRows;
    hueShiftInput.value = Math.round(360 / (numRows + 1));
}

function autoClampInputValue(valueInput) {
    valueInput.addEventListener('change', () => clampInputValue(valueInput));
}

function clampInputValue(valueInput) {
    if (valueInput.max !== undefined && valueInput.max != "") {
        valueInput.value = Math.min(parseFloat(valueInput.value), parseFloat(valueInput.max));
    }
    if (valueInput.min !== undefined && valueInput.min != "") {
        valueInput.value = Math.max(parseFloat(valueInput.value), parseFloat(valueInput.min));
    }
    if (valueInput.step !== undefined && valueInput.step != "") {
        let stepAmount = parseFloat(input.step);
        if (stepAmount == 1) {
            valueInput.value = Math.round(parseFloat(valueInput.value));
        } else {

        }
    }
}

function removeRow(rowIndex) {
    if (palette.length <= 1) return;
    commitPendingEdit();
    palette.splice(rowIndex, 1);
    if (activeRow > rowIndex || activeRow >= palette.length) activeRow--;
    rebuildAfterStructureChange();
}

function undo() {
    if (historyIndex > 0) restoreHistory(historyIndex - 1);
}

function redo() {
    if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1);
}

function updateHistoryButtons() {
    updateSwatchCountButtons();
    undoButton.disabled = historyIndex <= 0;
    redoButton.disabled = historyIndex >= history.length - 1;
}

function createSheet(rowIndex) {
    const sheet = document.createElement('div');
    sheet.className = 'hsv-sheet';
    sheet.style.setProperty('--columns', palette[rowIndex].length);
    sheetInputs = SHEET_CHANNELS.map(() => []);
    SHEET_CHANNELS.forEach((channel, channelIndex) => {
        palette[rowIndex].forEach((hsv, col) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.min = 0;
            input.max = channel.max;
            input.step = 1;
            input.value = Math.round(hsv[channelIndex]);
            input.title = channel.label;
            input.setAttribute('aria-label', `${channel.label} of color ${col + 1}`);
            enableDragScrub(input);
            input.addEventListener('focus', () => selectSwatch(rowIndex, col));
            input.addEventListener('input', () => updateFromSheet(col));
            input.addEventListener('change', commitPendingEdit);
            sheetInputs[channelIndex][col] = input;
            sheet.appendChild(input);
        });
    });
    return sheet;
}

function updateFromSheet(col) {
    const values = SHEET_CHANNELS.map((channel, channelIndex) => {
        const value = parseFloat(sheetInputs[channelIndex][col].value) || 0;
        return Math.max(0, Math.min(channel.max, value));
    });
    palette[activeRow][col] = values;
    isUpdatingFromSheet = true;
    updateSwatchSquare(activeRow, col);
    isUpdatingFromSheet = false;
    historyDirty = true;
    
    if (col === activeSwatchIndex) {
        isUpdatingFromInputs = true;
        colorWheel.hsv = values;
        isUpdatingFromInputs = false;
        updateInputsFromHSV(values);
    }
}

function updateSheetColumn(col) {
    if (!sheetInputs[0] || !sheetInputs[0][col]) return;
    const hsv = palette[activeRow][col];
    SHEET_CHANNELS.forEach((channel, channelIndex) => {
        sheetInputs[channelIndex][col].value = Math.round(hsv[channelIndex]);
    });
}

function createSwatchSquares() {
    swatchContainer.innerHTML = '';
    sheetRow = activeRow;
    sheetInputs = [];
    palette.forEach((colors, rowIndex) => {
        const rowElement = document.createElement('div');
        rowElement.className = 'swatch-row';
        
        const body = document.createElement('div');
        body.className = 'swatch-row-body';
        if (rowIndex === activeRow) {
            body.appendChild(createSheet(rowIndex));
        }
        
        const squares = document.createElement('div');
        squares.className = 'swatch-squares';
        colors.forEach((hsv, index) => {
            const square = document.createElement('div');
            square.className = 'swatch-square';
            if (rowIndex === activeRow && index === activeSwatchIndex) {
                square.classList.add('active');
            }
            square.style.backgroundColor = hsvToHex(hsv[0], hsv[1], hsv[2]);
            square.dataset.row = rowIndex;
            square.dataset.index = index;
            
            square.addEventListener('click', () => {
                selectSwatch(rowIndex, index);
            });
            
            squares.appendChild(square);
        });
        body.appendChild(squares);
        rowElement.appendChild(body);
        
        if (palette.length > 1) {
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'delete-row-button';
            deleteButton.title = 'Delete row';
            deleteButton.textContent = '\u{1F5D1}';
            deleteButton.addEventListener('click', () => removeRow(rowIndex));
            rowElement.appendChild(deleteButton);
        }
        
        swatchContainer.appendChild(rowElement);
    });
}

function selectSwatch(rowIndex, index) {
    activeRow = rowIndex;
    activeSwatchIndex = index;
    if (sheetRow !== rowIndex) {
        createSwatchSquares();
    }
    
    // Update all square active states
    swatchContainer.querySelectorAll('.swatch-square').forEach(square => {
        const isActive = Number(square.dataset.row) === rowIndex && Number(square.dataset.index) === index;
        square.classList.toggle('active', isActive);
    });
    
    // Update color wheel and inputs to match selected color
    const hsv = palette[rowIndex][index];
    isUpdatingFromInputs = true;
    colorWheel.hsv = hsv;
    isUpdatingFromInputs = false;
    
    updateInputsFromHSV(hsv);
}

function updateInputsFromHSV(hsv) {
    hueInput.value = Math.round(hsv[0]);
    saturationInput.value = Math.round(hsv[1]);
    brightnessInput.value = Math.round(hsv[2]);
}

function updateInputsFromWheel(color) {
    if (isUpdatingFromInputs) return;
    
    isUpdatingFromWheel = true;
    const hsv = color.hsv;
    updateInputsFromHSV(hsv);
    
    // Update the active swatch color
    palette[activeRow][activeSwatchIndex] = [hsv[0], hsv[1], hsv[2]];
    updateSwatchSquare(activeRow, activeSwatchIndex);
    historyDirty = true;
    
    isUpdatingFromWheel = false;
}

function updateSwatchSquare(rowIndex, index) {
    const square = swatchContainer.querySelector(`[data-row="${rowIndex}"][data-index="${index}"]`);
    if (square) {
        const hsv = palette[rowIndex][index];
        square.style.backgroundColor = hsvToHex(hsv[0], hsv[1], hsv[2]);
    }
    if (!isUpdatingFromSheet && rowIndex === activeRow) {
        updateSheetColumn(index);
    }
}

function updateWheelFromInputs() {
    if (isUpdatingFromWheel) return;
    
    const h = parseFloat(hueInput.value) || 0;
    const s = parseFloat(saturationInput.value) || 0;
    const b = parseFloat(brightnessInput.value) || 0;
    
    // Clamp values to valid ranges
    const clampedH = Math.max(0, Math.min(360, h));
    const clampedS = Math.max(0, Math.min(100, s));
    const clampedB = Math.max(0, Math.min(100, b));
    
    isUpdatingFromInputs = true;
    colorWheel.hsv = [clampedH, clampedS, clampedB];
    
    // Update the palette array
    palette[activeRow][activeSwatchIndex] = [clampedH, clampedS, clampedB];
    updateSwatchSquare(activeRow, activeSwatchIndex);
    historyDirty = true;
    
    isUpdatingFromInputs = false;
}

function createRampSequence(row, index, hRamp, resetSV) {
    let rootH = palette[row][index][0];
    let rootS = palette[row][index][1];
    let rootV = palette[row][index][2];
    for (let i = 0; i < palette[row].length; ++i) {
        if (i == index) {
            continue;
        }
        let mul = i - index;
        let currentS = resetSV ? rootS : palette[row][i][1];
        let currentV = resetSV ? rootV : palette[row][i][2];
        palette[row][i] = [(((rootH + hRamp * mul) % 360) + 360) % 360, currentS, currentV];
    }
    createSwatchSquares();
    selectSwatch(activeRow, activeSwatchIndex);
    recordHistory();
}

function applyRampToActiveRow() {
    commitPendingEdit();
    const parsed = parseInt(rampInput.value, 10);
    const hRamp = Number.isNaN(parsed) ? DEFAULT_RAMP : parsed;
    createRampSequence(activeRow, activeSwatchIndex, hRamp, rampResetSV.checked);
}

function showToast(message) {
    toastMessage.textContent = message;
    toast.hidden = false;
}

async function savePaletteImage() {
    commitPendingEdit();
    let handle = null;
    if (window.showSaveFilePicker) {
        try {
            handle = await window.showSaveFilePicker({
                suggestedName: 'palette.png',
                types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }]
            });
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error(error);
        }
    }
    const image = capturePaletteImage();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').putImageData(image, 0, 0);
    canvas.toBlob(async (blob) => {
        if (handle) {
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'palette.png';
        link.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

function loadPaletteFromBitmap(bitmap) {
    const width = Math.min(bitmap.width, MAX_IMAGE_SIZE);
    const height = Math.min(bitmap.height, MAX_IMAGE_SIZE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);

    commitPendingEdit();
    palette.length = height;
    for (let y = 0; y < height; y++) {
        palette[y] = [];
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            palette[y][x] = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
        }
    }
    activeRow = 0;
    activeSwatchIndex = 0;
    rebuildAfterStructureChange();

    if (bitmap.width > MAX_IMAGE_SIZE || bitmap.height > MAX_IMAGE_SIZE) {
        showToast(`Image is ${bitmap.width}x${bitmap.height}; only the top-left ${width}x${height} pixels were loaded.`);
    }
}

async function loadPaletteImage(file) {
    if (!file) {
        return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        showToast('Unsupported file type. Please choose a PNG, BMP, or GIF image.');
        return;
    }
    try {
        const bitmap = await createImageBitmap(file);
        loadPaletteFromBitmap(bitmap);
        bitmap.close();
    } catch (error) {
        showToast('Could not read that image file.');
    }
}

function desaturationFlip(desaturationFactor) {
    commitPendingEdit();
    for (let y = 0; y < palette.length; y++) {
        let offset = palette[y].length - 1;
        let adds = palette[y].length - 2;
        palette[y].length += adds;
        for (let x = 1; x <= adds; ++x) {
            palette[y][offset + x] = [...palette[y][offset - x]]
            palette[y][offset + x][1] *= desaturationFactor;
        }
    }
    rebuildAfterStructureChange();
}

// Create the color wheel element
const colorWheel = new ReinventedColorWheel({
    appendTo: document.getElementById('colorWheel'),
    hsv: palette[0][0],
    wheelDiameter: 200,
    wheelThickness: 20,
    handleDiameter: 16,
    wheelReflectsSaturation: true,
    onChange: function(color) {
        updateInputsFromWheel(color);
    }
});

undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.target.tagName === 'INPUT') return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); redo(); }
});

[hueInput, saturationInput, brightnessInput].forEach(enableDragScrub);

// Record only when the user finishes a discrete edit (mouse released or input committed)
document.addEventListener('pointerup', commitPendingEdit);
[hueInput, saturationInput, brightnessInput].forEach(input => {
    input.addEventListener('change', commitPendingEdit);
});

addSwatchButton.addEventListener('click', addSwatch);
removeSwatchButton.addEventListener('click', removeSwatch);
addRowButton.addEventListener('click', addRows);

rampInput.addEventListener('input', () => {
    const digits = rampInput.value.replace(/\D/g, '');
    rampInput.value = digits === '' ? '' : String(Math.min(360, parseInt(digits, 10)));
});
rampInput.addEventListener('blur', () => {
    if (rampInput.value === '') rampInput.value = DEFAULT_RAMP;
});
rampButton.addEventListener('click', applyRampToActiveRow);

// Add input event listeners for real-time updates as user types
hueInput.addEventListener('input', updateWheelFromInputs);
saturationInput.addEventListener('input', updateWheelFromInputs);
brightnessInput.addEventListener('input', updateWheelFromInputs);

numRowsInput.addEventListener('change', autoSetHueShift);
autoClampInputValue(hueShiftInput);
autoSetHueShift();

desaturationFlipButton.addEventListener('click', () => {
    desaturationFlip(desaturationFactorInput.value);
});
autoClampInputValue(desaturationFactorInput);

// Initialize display
createSwatchSquares();
updateInputsFromHSV(palette[0][0]);
recordHistory();

document.getElementById('toastDismiss').addEventListener('click', () => {
    toast.hidden = true;
});

saveButton.addEventListener('click', savePaletteImage);
loadButton.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', () => {
    loadPaletteImage(loadInput.files[0]);
    loadInput.value = '';
});
