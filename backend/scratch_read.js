const readXlsxFile = require('read-excel-file/node');
const filePath = "C:\\Users\\diego\\Documents\\Relatório Equipamentos - Completo 2026.xls";

(async () => {
    try {
        if (!/\.xlsx$/i.test(filePath)) throw new Error('Este script aceita somente .xlsx.');
        const data = await readXlsxFile(filePath);

        if (data.length > 0) {
            console.log('Headers found:', data[0]);
        } else {
            console.log('No data found in the sheet.');
        }
    } catch (err) {
        console.error('Error reading file:', err.message);
    }
})();
