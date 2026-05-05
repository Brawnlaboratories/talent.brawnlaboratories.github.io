(function () {
    function normalizeKey(key) {
        if (!key) return '';
        return String(key).trim().toLowerCase().replace(/[\s\-\.]+/g, '_');
    }

    async function fetchArrayBuffer(templateUrl) {
        const res = await fetch(templateUrl, { mode: 'cors' });
        if (!res.ok) throw new Error('Unable to fetch template: ' + res.status);
        return await res.arrayBuffer();
    }

    async function getTemplateInfo(templateUrl) {
        const buffer = await fetchArrayBuffer(templateUrl);
        const pdfDoc = await PDFLib.PDFDocument.load(buffer);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        let fields = [];
        try {
            const form = pdfDoc.getForm();
            fields = form.getFields().map(field => ({
                name: field.getName(),
                type: field.constructor.name
            }));
        } catch (e) {
            fields = [];
        }

        return {
            fields,
            pageCount: pages.length,
            pageSize: firstPage ? { width: firstPage.getWidth(), height: firstPage.getHeight() } : { width: 0, height: 0 }
        };
    }

    async function getTemplateFields(templateUrl) {
        return (await getTemplateInfo(templateUrl)).fields;
    }

    async function getTemplatePageSize(templateUrl) {
        const buffer = await fetchArrayBuffer(templateUrl);
        const pdfDoc = await PDFLib.PDFDocument.load(buffer);
        const page = pdfDoc.getPages()[0];
        if (!page) return { width: 0, height: 0 };
        return { width: page.getWidth(), height: page.getHeight() };
    }

    function getMappingValue(key, data) {
        const normKey = normalizeKey(key);
        for (const dataKey of Object.keys(data)) {
            if (normalizeKey(dataKey) === normKey) return data[dataKey];
        }
        // try contains
        const lowerKey = normKey;
        for (const dataKey of Object.keys(data)) {
            if (normalizeKey(dataKey).includes(lowerKey) || lowerKey.includes(normalizeKey(dataKey))) {
                return data[dataKey];
            }
        }
        return '';
    }

    function flattenDate(value) {
        if (!value) return '';
        if (value instanceof Date) return value.toLocaleDateString();
        if (typeof value === 'string') return value;
        if (value.toDate) return value.toDate().toLocaleDateString();
        return String(value);
    }

    function toPdfSafeText(value) {
        if (value == null) return '';
        return String(value)
            .replace(/\u20b9/g, 'Rs.')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201c\u201d]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u2026/g, '...')
            .replace(/\u00a0/g, ' ')
            .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
    }

    async function fillPdfForm(templateUrl, data, options = {}) {
        const buffer = await fetchArrayBuffer(templateUrl);
        const pdfDoc = await PDFLib.PDFDocument.load(buffer);

        let hasForm = true;
        let form = null;

        try {
            form = pdfDoc.getForm();
            const fields = form.getFields();
            if (!fields || fields.length === 0) hasForm = false;
            else {
                fields.forEach(field => {
                    const name = field.getName();
                    const rawValue = getMappingValue(name, data);
                    const value = toPdfSafeText(rawValue);

                    const fieldType = field.constructor.name;
                    if (fieldType === 'PDFTextField' || fieldType === 'PDFDropdown' || fieldType === 'PDFOptionList') {
                        if (value !== '') {
                            try { field.setText(value); } catch (err) { console.warn('Skipping PDF field', name, err); }
                        }
                    } else if (fieldType === 'PDFCheckBox') {
                        if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) field.check();
                        else field.uncheck();
                    } else if (fieldType === 'PDFRadioGroup') {
                        try { field.select(value); } catch (err) { /* ignore invalid value */ }
                    } else if (fieldType === 'PDFButton') {
                        // no-op
                    } else {
                        try { field.setText(value); } catch (err) { console.warn('Skipping PDF field', name, err); }
                    }
                });
            }
        } catch (e) {
            hasForm = false;
        }

        if (!hasForm) {
            const pages = pdfDoc.getPages();
            const firstPage = pages[0];
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
            const pageHeight = firstPage.getHeight();

            // coordinate map takes precedence, if provided
            const coordMap = options.coordMap || {};
            if (Object.keys(coordMap).length > 0) {
                for (const [fieldKey, coords] of Object.entries(coordMap)) {
                    const value = toPdfSafeText(getMappingValue(fieldKey, data));
                    if (!value) continue;

                    const x = coords.x || 40;
                    const y = coords.y || (pageHeight - 60);
                    const size = coords.size || 11;
                    const color = coords.color || PDFLib.rgb(0,0,0);

                    firstPage.drawText(value, {
                        x,
                        y,
                        size,
                        font,
                        color
                    });
                }
            } else {
                // fallback content block
                let textLines = [];
                for (const [key, value] of Object.entries(data)) {
                    const safeLine = toPdfSafeText(`${key}: ${value}`);
                    if (!safeLine.trim()) continue;
                    textLines.push(safeLine);
                    if (textLines.length >= 20) break;
                }

                const lineHeight = 12;
                textLines.forEach((line, idx) => {
                    firstPage.drawText(line, {
                        x: 40,
                        y: pageHeight - 60 - idx * lineHeight,
                        size: 10,
                        font,
                        color: PDFLib.rgb(0, 0, 0)
                    });
                });
            }
        }

        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: 'application/pdf' });
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'document.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    window.pdfService = {
        getTemplateInfo,
        getTemplateFields,
        getTemplatePageSize,
        fillPdfForm,
        downloadBlob,
        normalizeKey,
        getMappingValue,
        flattenDate,
        toPdfSafeText
    };
})();
