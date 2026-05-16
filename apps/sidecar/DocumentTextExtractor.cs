using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

public sealed record ExtractedDocumentText(
    string Kind,
    string Text,
    bool Truncated,
    IReadOnlyList<string> Warnings);

public static partial class DocumentTextExtractor
{
    private const long MaxContainerBytes = 25 * 1024 * 1024;

    public static bool IsSupported(string path)
    {
        var extension = Path.GetExtension(path).ToLowerInvariant();
        return extension is ".docx" or ".pptx" or ".xlsx" or ".xlsm" or ".pdf";
    }

    public static async Task<ExtractedDocumentText> ExtractAsync(
        string path,
        int maxChars,
        CancellationToken cancellationToken)
    {
        var info = new FileInfo(path);
        if (info.Length > MaxContainerBytes)
        {
            throw new InvalidOperationException($"Document is too large to extract: {info.Length} bytes.");
        }

        var extension = Path.GetExtension(path).ToLowerInvariant();
        return extension switch
        {
            ".docx" => ExtractDocx(path, maxChars, cancellationToken),
            ".pptx" => ExtractPptx(path, maxChars, cancellationToken),
            ".xlsx" or ".xlsm" => ExtractWorkbook(path, maxChars, cancellationToken),
            ".pdf" => await ExtractPdfAsync(path, maxChars, cancellationToken),
            _ => throw new InvalidOperationException($"Unsupported document extension: {extension}"),
        };
    }

    private static ExtractedDocumentText ExtractDocx(string path, int maxChars, CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(path);
        var builder = new StringBuilder();
        var warnings = new List<string>();
        foreach (var entry in archive.Entries
            .Where(entry => entry.FullName.StartsWith("word/", StringComparison.OrdinalIgnoreCase)
                && entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)
                && !entry.FullName.Contains("/_rels/", StringComparison.OrdinalIgnoreCase))
            .OrderBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            AppendXmlText(entry, builder, maxChars);
            if (builder.Length >= maxChars) break;
        }

        if (builder.Length == 0) warnings.Add("No text nodes were found in the DOCX package.");
        return Complete("docx", builder, maxChars, warnings);
    }

    private static ExtractedDocumentText ExtractPptx(string path, int maxChars, CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(path);
        var builder = new StringBuilder();
        var warnings = new List<string>();
        foreach (var entry in archive.Entries
            .Where(entry =>
                (entry.FullName.StartsWith("ppt/slides/", StringComparison.OrdinalIgnoreCase)
                    || entry.FullName.StartsWith("ppt/notesSlides/", StringComparison.OrdinalIgnoreCase))
                && entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
            .OrderBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (entry.FullName.StartsWith("ppt/slides/", StringComparison.OrdinalIgnoreCase))
            {
                AppendLine(builder, $"Slide {Path.GetFileNameWithoutExtension(entry.Name)}", maxChars);
            }
            AppendXmlText(entry, builder, maxChars);
            if (builder.Length >= maxChars) break;
        }

        if (builder.Length == 0) warnings.Add("No slide text nodes were found in the PPTX package.");
        return Complete("pptx", builder, maxChars, warnings);
    }

    private static ExtractedDocumentText ExtractWorkbook(string path, int maxChars, CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(path);
        var sharedStrings = ReadSharedStrings(archive);
        var builder = new StringBuilder();
        var warnings = new List<string>();
        foreach (var entry in archive.Entries
            .Where(entry => entry.FullName.StartsWith("xl/worksheets/", StringComparison.OrdinalIgnoreCase)
                && entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
            .OrderBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            AppendLine(builder, $"Sheet {Path.GetFileNameWithoutExtension(entry.Name)}", maxChars);
            AppendWorksheetText(entry, sharedStrings, builder, maxChars);
            if (builder.Length >= maxChars) break;
        }

        if (builder.Length == 0) warnings.Add("No cell values were found in the workbook package.");
        return Complete(Path.GetExtension(path).TrimStart('.').ToLowerInvariant(), builder, maxChars, warnings);
    }

    private static async Task<ExtractedDocumentText> ExtractPdfAsync(
        string path,
        int maxChars,
        CancellationToken cancellationToken)
    {
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        var source = Encoding.Latin1.GetString(bytes);
        var builder = new StringBuilder();
        var warnings = new List<string>();

        var streamSources = ExtractPdfStreamSources(source, warnings);
        var textSources = streamSources.Count > 0 ? streamSources : [source];
        foreach (var textSource in textSources)
        {
            AppendPdfTextOperators(textSource, builder, maxChars, cancellationToken);
            if (builder.Length >= maxChars) break;
        }

        if (builder.Length == 0 && streamSources.Count > 0)
        {
            AppendPdfTextOperators(source, builder, maxChars, cancellationToken);
        }

        if (builder.Length == 0) warnings.Add("No PDF text-layer operators were found. OCR and image-only PDFs are not supported.");
        return Complete("pdf", builder, maxChars, warnings);
    }

    private static List<string> ExtractPdfStreamSources(string source, List<string> warnings)
    {
        var sources = new List<string>();
        foreach (Match match in PdfStreamRegex().Matches(source))
        {
            var dictionary = match.Groups["dict"].Value;
            var data = TrimPdfStreamBytes(Encoding.Latin1.GetBytes(match.Groups["data"].Value));
            var filters = ReadPdfFilters(dictionary);
            if (filters.Count == 0)
            {
                sources.Add(Encoding.Latin1.GetString(data));
                continue;
            }

            try
            {
                var decoded = data;
                foreach (var filter in filters)
                {
                    decoded = DecodePdfFilter(filter, decoded);
                }
                sources.Add(Encoding.Latin1.GetString(decoded));
            }
            catch (NotSupportedException ex)
            {
                AddDistinctWarning(warnings, ex.Message);
            }
            catch (Exception ex) when (ex is FormatException or InvalidDataException or IOException or OverflowException)
            {
                AddDistinctWarning(warnings, $"PDF stream decode failed: {ex.Message}");
            }
        }

        return sources;
    }

    private static void AppendPdfTextOperators(
        string source,
        StringBuilder builder,
        int maxChars,
        CancellationToken cancellationToken)
    {
        foreach (Match match in PdfLiteralTjRegex().Matches(source))
        {
            cancellationToken.ThrowIfCancellationRequested();
            AppendLine(builder, DecodePdfLiteral(match.Groups["text"].Value), maxChars);
            if (builder.Length >= maxChars) break;
        }

        if (builder.Length < maxChars)
        {
            foreach (Match match in PdfHexTjRegex().Matches(source))
            {
                cancellationToken.ThrowIfCancellationRequested();
                AppendLine(builder, DecodePdfHex(match.Groups["hex"].Value), maxChars);
                if (builder.Length >= maxChars) break;
            }
        }

        if (builder.Length < maxChars)
        {
            foreach (Match match in PdfArrayTextRegex().Matches(source))
            {
                cancellationToken.ThrowIfCancellationRequested();
                foreach (Match literal in PdfLiteralRegex().Matches(match.Groups["items"].Value))
                {
                    AppendLine(builder, DecodePdfLiteral(literal.Groups["text"].Value), maxChars);
                    if (builder.Length >= maxChars) break;
                }
                if (builder.Length >= maxChars) break;
            }
        }
    }

    private static IReadOnlyList<string> ReadSharedStrings(ZipArchive archive)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml");
        if (entry is null) return [];
        var document = LoadXml(entry);
        return document.Descendants()
            .Where(element => element.Name.LocalName == "si")
            .Select(item => NormalizeText(string.Join("", item.Descendants()
                .Where(element => element.Name.LocalName == "t")
                .Select(element => element.Value))))
            .ToArray();
    }

    private static void AppendWorksheetText(
        ZipArchiveEntry entry,
        IReadOnlyList<string> sharedStrings,
        StringBuilder builder,
        int maxChars)
    {
        var document = LoadXml(entry);
        foreach (var cell in document.Descendants().Where(element => element.Name.LocalName == "c"))
        {
            var reference = cell.Attribute("r")?.Value ?? "";
            var type = cell.Attribute("t")?.Value ?? "";
            var value = CellText(cell, type, sharedStrings);
            if (string.IsNullOrWhiteSpace(value)) continue;
            AppendLine(builder, string.IsNullOrWhiteSpace(reference) ? value : $"{reference}\t{value}", maxChars);
            if (builder.Length >= maxChars) break;
        }
    }

    private static string CellText(XElement cell, string type, IReadOnlyList<string> sharedStrings)
    {
        if (type == "inlineStr")
        {
            return NormalizeText(string.Join("", cell.Descendants()
                .Where(element => element.Name.LocalName == "t")
                .Select(element => element.Value)));
        }

        var raw = cell.Descendants().FirstOrDefault(element => element.Name.LocalName == "v")?.Value ?? "";
        if (type == "s" && int.TryParse(raw, out var index) && index >= 0 && index < sharedStrings.Count)
        {
            return sharedStrings[index];
        }

        return NormalizeText(raw);
    }

    private static void AppendXmlText(ZipArchiveEntry entry, StringBuilder builder, int maxChars)
    {
        var document = LoadXml(entry);
        foreach (var text in document.Descendants()
            .Where(element => element.Name.LocalName == "t")
            .Select(element => NormalizeText(element.Value))
            .Where(text => !string.IsNullOrWhiteSpace(text)))
        {
            AppendLine(builder, text, maxChars);
            if (builder.Length >= maxChars) break;
        }
    }

    private static XDocument LoadXml(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
        });
        return XDocument.Load(reader, LoadOptions.None);
    }

    private static ExtractedDocumentText Complete(
        string kind,
        StringBuilder builder,
        int maxChars,
        List<string> warnings)
    {
        var text = builder.ToString().Trim();
        var truncated = builder.Length >= maxChars || text.Length > maxChars;
        if (text.Length > maxChars) text = text[..maxChars];
        return new ExtractedDocumentText(kind, text, truncated, warnings);
    }

    private static void AppendLine(StringBuilder builder, string value, int maxChars)
    {
        var normalized = NormalizeText(value);
        if (string.IsNullOrWhiteSpace(normalized) || builder.Length >= maxChars) return;
        if (builder.Length > 0) builder.AppendLine();
        var remaining = maxChars - builder.Length;
        builder.Append(normalized.Length > remaining ? normalized[..remaining] : normalized);
    }

    private static string NormalizeText(string text) => WhitespaceRegex().Replace(text, " ").Trim();

    private static string DecodePdfLiteral(string text)
    {
        var builder = new StringBuilder();
        for (var index = 0; index < text.Length; index++)
        {
            var current = text[index];
            if (current != '\\' || index + 1 >= text.Length)
            {
                builder.Append(current);
                continue;
            }

            var next = text[++index];
            switch (next)
            {
                case 'n': builder.Append('\n'); break;
                case 'r': builder.Append('\r'); break;
                case 't': builder.Append('\t'); break;
                case 'b': builder.Append('\b'); break;
                case 'f': builder.Append('\f'); break;
                case '(':
                case ')':
                case '\\':
                    builder.Append(next);
                    break;
                default:
                    if (next is >= '0' and <= '7')
                    {
                        var octal = next.ToString();
                        for (var count = 0; count < 2 && index + 1 < text.Length && text[index + 1] is >= '0' and <= '7'; count++)
                        {
                            octal += text[++index];
                        }
                        builder.Append((char)Convert.ToInt32(octal, 8));
                    }
                    else
                    {
                        builder.Append(next);
                    }
                    break;
            }
        }
        return NormalizeText(builder.ToString());
    }

    private static string DecodePdfHex(string hex)
    {
        var clean = Regex.Replace(hex, @"\s+", "");
        if (clean.Length % 2 == 1) clean += "0";
        var bytes = new byte[clean.Length / 2];
        for (var index = 0; index < bytes.Length; index++)
        {
            bytes[index] = Convert.ToByte(clean.Substring(index * 2, 2), 16);
        }
        return NormalizeText(Encoding.Latin1.GetString(bytes));
    }

    private static IReadOnlyList<string> ReadPdfFilters(string dictionary)
    {
        var match = PdfFilterRegex().Match(dictionary);
        if (!match.Success) return [];

        if (match.Groups["single"].Success)
        {
            return [match.Groups["single"].Value];
        }

        return PdfFilterNameRegex()
            .Matches(match.Groups["array"].Value)
            .Select(filter => filter.Groups["name"].Value)
            .ToArray();
    }

    private static byte[] DecodePdfFilter(string filter, byte[] data)
    {
        return filter switch
        {
            "FlateDecode" or "Fl" => InflatePdfFlate(data),
            "ASCIIHexDecode" or "AHx" => DecodePdfAsciiHex(data),
            "ASCII85Decode" or "A85" => DecodePdfAscii85(data),
            _ => throw new NotSupportedException($"PDF stream filter /{filter} is not supported."),
        };
    }

    private static byte[] InflatePdfFlate(byte[] data)
    {
        try
        {
            return InflatePdfFlateWith(data, stream => new ZLibStream(stream, CompressionMode.Decompress));
        }
        catch (InvalidDataException)
        {
            return InflatePdfFlateWith(data, stream => new DeflateStream(stream, CompressionMode.Decompress));
        }
    }

    private static byte[] InflatePdfFlateWith(byte[] data, Func<Stream, Stream> createStream)
    {
        using var input = new MemoryStream(data);
        using var output = new MemoryStream();
        using var decoder = createStream(input);
        decoder.CopyTo(output);
        return output.ToArray();
    }

    private static byte[] DecodePdfAsciiHex(byte[] data)
    {
        var source = Encoding.Latin1.GetString(data);
        var builder = new StringBuilder();
        foreach (var current in source)
        {
            if (current == '>') break;
            if (char.IsWhiteSpace(current)) continue;
            if (!Uri.IsHexDigit(current)) throw new FormatException("Invalid ASCIIHexDecode data.");
            builder.Append(current);
        }

        if (builder.Length % 2 == 1) builder.Append('0');
        var bytes = new byte[builder.Length / 2];
        for (var index = 0; index < bytes.Length; index++)
        {
            bytes[index] = Convert.ToByte(builder.ToString(index * 2, 2), 16);
        }
        return bytes;
    }

    private static byte[] DecodePdfAscii85(byte[] data)
    {
        var source = Encoding.Latin1.GetString(data);
        var output = new List<byte>();
        var group = new List<int>(5);
        foreach (var current in source)
        {
            if (char.IsWhiteSpace(current)) continue;
            if (current == '~') break;
            if (current == 'z')
            {
                if (group.Count != 0) throw new FormatException("Invalid ASCII85Decode zero group.");
                output.AddRange([0, 0, 0, 0]);
                continue;
            }

            if (current is < '!' or > 'u') throw new FormatException("Invalid ASCII85Decode data.");
            group.Add(current - '!');
            if (group.Count == 5)
            {
                AppendAscii85Group(output, group, 4);
                group.Clear();
            }
        }

        if (group.Count > 0)
        {
            if (group.Count == 1) throw new FormatException("Invalid trailing ASCII85Decode group.");
            var bytesToWrite = group.Count - 1;
            while (group.Count < 5) group.Add('u' - '!');
            AppendAscii85Group(output, group, bytesToWrite);
        }

        return output.ToArray();
    }

    private static void AppendAscii85Group(List<byte> output, IReadOnlyList<int> group, int bytesToWrite)
    {
        uint value = 0;
        foreach (var item in group)
        {
            value = checked(value * 85u + (uint)item);
        }

        var bytes = new[]
        {
            (byte)(value >> 24),
            (byte)(value >> 16),
            (byte)(value >> 8),
            (byte)value,
        };
        output.AddRange(bytes.Take(bytesToWrite));
    }

    private static byte[] TrimPdfStreamBytes(byte[] data)
    {
        var start = 0;
        if (data.Length >= 2 && data[0] == '\r' && data[1] == '\n') start = 2;
        else if (data.Length >= 1 && data[0] is (byte)'\r' or (byte)'\n') start = 1;

        var end = data.Length;
        if (end - start >= 2 && data[end - 2] == '\r' && data[end - 1] == '\n') end -= 2;
        else if (end - start >= 1 && data[end - 1] is (byte)'\r' or (byte)'\n') end -= 1;

        return data[start..end];
    }

    private static void AddDistinctWarning(List<string> warnings, string warning)
    {
        if (!warnings.Contains(warning, StringComparer.Ordinal)) warnings.Add(warning);
    }

    [GeneratedRegex(@"(?<dict><<.*?>>)\s*stream(?<data>.*?)endstream", RegexOptions.Singleline)]
    private static partial Regex PdfStreamRegex();

    [GeneratedRegex(@"/Filter\s*(?:/(?<single>[A-Za-z0-9]+)|\[(?<array>.*?)\])", RegexOptions.Singleline)]
    private static partial Regex PdfFilterRegex();

    [GeneratedRegex(@"/(?<name>[A-Za-z0-9]+)")]
    private static partial Regex PdfFilterNameRegex();

    [GeneratedRegex(@"\((?<text>(?:\\.|[^\\)])*)\)\s*Tj", RegexOptions.Singleline)]
    private static partial Regex PdfLiteralTjRegex();

    [GeneratedRegex(@"<(?<hex>[0-9A-Fa-f\s]+)>\s*Tj", RegexOptions.Singleline)]
    private static partial Regex PdfHexTjRegex();

    [GeneratedRegex(@"\[(?<items>.*?)\]\s*TJ", RegexOptions.Singleline)]
    private static partial Regex PdfArrayTextRegex();

    [GeneratedRegex(@"\((?<text>(?:\\.|[^\\)])*)\)", RegexOptions.Singleline)]
    private static partial Regex PdfLiteralRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
