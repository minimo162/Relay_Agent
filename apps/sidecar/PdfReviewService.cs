using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

public sealed partial class PdfReviewService
{
    private const int MaxUploadedPdfBytes = 50 * 1024 * 1024;
    private const int MaxReviewDocuments = 8;
    private const int FallbackSectionPageWindow = 6;
    private readonly string _jobsRoot;

    public PdfReviewService(string dataDirectory)
    {
        _jobsRoot = Path.Combine(dataDirectory, "pdf-review", "jobs");
        Directory.CreateDirectory(_jobsRoot);
    }

    public async Task<PdfReviewJobResponse> ReviewMultipartAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
        {
            throw new InvalidOperationException("PDF review requires multipart/form-data.");
        }

        var form = await request.ReadFormAsync(cancellationToken);
        var reviewType = NormalizeReviewType(form["reviewType"].FirstOrDefault());
        var availableFiles = form.Files.Where(file => file.Length > 0).ToArray();
        var files = availableFiles.Take(MaxReviewDocuments).ToArray();
        if (files.Length == 0)
        {
            throw new InvalidOperationException("Select at least one PDF.");
        }
        if (availableFiles.Length > MaxReviewDocuments)
        {
            throw new InvalidOperationException($"Select {MaxReviewDocuments} or fewer PDFs.");
        }
        if (reviewType == "compare" && files.Length < 2)
        {
            throw new InvalidOperationException("Two or more PDFs are required for comparison.");
        }

        var job = CreateJobDirectory();
        var staged = new List<PdfReviewInput>();
        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!IsPdfName(file.FileName))
            {
                throw new InvalidOperationException($"Only PDF files are supported: {file.FileName}");
            }
            if (file.Length > MaxUploadedPdfBytes)
            {
                throw new InvalidOperationException($"PDF is too large: {file.FileName} ({file.Length} bytes).");
            }

            var safeName = SafeFileName(file.FileName);
            var path = Path.Combine(job.Directory, safeName);
            await using var output = File.Create(path);
            await file.CopyToAsync(output, cancellationToken);
            staged.Add(new PdfReviewInput(path, safeName, staged.Count + 1));
        }

        return await BuildJobAsync(job, reviewType, staged, cancellationToken);
    }

    public async Task<PdfReviewJobResponse> ReviewPathsAsync(PdfReviewPathRequest request, CancellationToken cancellationToken)
    {
        var reviewType = NormalizeReviewType(request.ReviewType);
        var paths = request.Paths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => Path.GetFullPath(Environment.ExpandEnvironmentVariables(path)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxReviewDocuments)
            .ToArray();

        if (paths.Length == 0)
        {
            throw new InvalidOperationException("At least one PDF path is required.");
        }
        if (request.Paths.Count(path => !string.IsNullOrWhiteSpace(path)) > MaxReviewDocuments)
        {
            throw new InvalidOperationException($"Select {MaxReviewDocuments} or fewer PDFs.");
        }
        if (reviewType == "compare" && paths.Length < 2)
        {
            throw new InvalidOperationException("Two or more PDF paths are required for comparison.");
        }

        var inputs = new List<PdfReviewInput>();
        foreach (var path in paths)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("PDF file was not found.", path);
            }
            if (!IsPdfName(path))
            {
                throw new InvalidOperationException($"Only PDF files are supported: {path}");
            }
            inputs.Add(new PdfReviewInput(path, Path.GetFileName(path), inputs.Count + 1));
        }

        return await BuildJobAsync(CreateJobDirectory(), reviewType, inputs, cancellationToken);
    }

    public async Task<PdfReviewJobResponse?> GetJobAsync(string jobId, CancellationToken cancellationToken)
    {
        var path = JobJsonPath(jobId);
        if (!File.Exists(path)) return null;
        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<PdfReviewJobResponse>(stream, JsonOptions.Default, cancellationToken);
    }

    public string? GetReportPath(string jobId)
    {
        var path = ReportPath(jobId);
        return File.Exists(path) ? path : null;
    }

    public bool DeleteJob(string jobId)
    {
        if (!IsSafeJobId(jobId)) return false;
        var directory = Path.Combine(_jobsRoot, jobId);
        if (!Directory.Exists(directory)) return false;
        Directory.Delete(directory, recursive: true);
        return true;
    }

    private async Task<PdfReviewJobResponse> BuildJobAsync(
        PdfReviewJobHandle job,
        string reviewType,
        IReadOnlyList<PdfReviewInput> inputs,
        CancellationToken cancellationToken)
    {
        var effectiveReviewType = ResolveReviewType(reviewType, inputs.Count);
        var status = "completed";
        var documents = new List<PdfReviewDocumentWork>();
        var limitations = new List<string>();
        foreach (var input in inputs)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var document = await ExtractDocumentAsync(input, cancellationToken);
            documents.Add(document);
            foreach (var warning in document.Warnings)
            {
                AddDistinct(limitations, $"{document.DisplayName}: {warning}");
            }
            if (document.Pages.Count == 0 || document.Pages.All(page => string.IsNullOrWhiteSpace(page.Text)))
            {
                status = "partial";
                AddDistinct(limitations, $"{document.DisplayName}: text layer was not available; OCR is not included.");
            }
        }

        var alignments = BuildSectionAlignments(documents);
        if (documents.Count >= 2 && alignments.Count == 0)
        {
            status = "partial";
            AddDistinct(limitations, "No comparable sections were detected across the selected PDFs.");
        }
        foreach (var document in documents.Where(document => document.SectionFallbackUsed))
        {
            AddDistinct(limitations, $"{document.DisplayName}: no clear chapter headings were detected; page-range sections were used.");
        }

        var findings = BuildFindings(effectiveReviewType, documents, alignments);
        if (documents.Any(document => document.ExtractionTruncated))
        {
            status = status == "completed" ? "partial" : status;
            AddDistinct(limitations, "Some extracted text was truncated to stay within local review limits.");
        }

        var responseDocuments = documents.Select(document => document.ToPublic()).ToArray();
        var responseFindings = findings.ToArray();
        var responseAlignments = alignments.ToArray();
        var report = BuildMarkdownReport(job.JobId, effectiveReviewType, responseDocuments, responseAlignments, responseFindings, limitations);
        var response = new PdfReviewJobResponse(
            SchemaVersion: "RelayPdfReviewJob.v1",
            JobId: job.JobId,
            Status: status,
            ReviewType: effectiveReviewType,
            CreatedAt: DateTimeOffset.UtcNow,
            Documents: responseDocuments,
            Findings: responseFindings,
            SectionAlignments: responseAlignments,
            Limitations: limitations.ToArray(),
            ReportMarkdown: report);

        await File.WriteAllTextAsync(JobJsonPath(job.JobId), JsonSerializer.Serialize(response, JsonOptions.Default), cancellationToken);
        await File.WriteAllTextAsync(ReportPath(job.JobId), report, cancellationToken);
        return response;
    }

    private async Task<PdfReviewDocumentWork> ExtractDocumentAsync(PdfReviewInput input, CancellationToken cancellationToken)
    {
        var map = await DocumentTextExtractor.ExtractAsync(input.Path, 160_000, cancellationToken, mode: "map");
        var pages = new List<PdfReviewPageWork>();
        var warnings = map.Warnings.ToList();
        var pageNumbers = map.Pages is { Count: > 0 }
            ? map.Pages.Select(page => page.Number).Distinct().Order().ToArray()
            : new[] { 1 };

        foreach (var pageNumber in pageNumbers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ExtractedDocumentText pageContent;
            try
            {
                pageContent = await DocumentTextExtractor.ExtractAsync(
                    input.Path,
                    14_000,
                    cancellationToken,
                    pageStart: pageNumber,
                    pageEnd: pageNumber);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                AddDistinct(warnings, $"Page {pageNumber} extraction failed: {ex.Message}");
                pageContent = new ExtractedDocumentText("pdf", "", false, [ex.Message], PageStart: pageNumber, PageEnd: pageNumber);
            }

            foreach (var warning in pageContent.Warnings)
            {
                AddDistinct(warnings, warning);
            }

            var text = NormalizeWhitespace(pageContent.Text);
            if (string.IsNullOrWhiteSpace(text) && map.Pages is { Count: > 0 })
            {
                var mapped = map.Pages.FirstOrDefault(page => page.Number == pageNumber);
                if (mapped is not null) text = mapped.Preview;
            }

            pages.Add(new PdfReviewPageWork(
                Page: pageNumber,
                CharCount: text.Length,
                Preview: Preview(text, 260),
                Text: text));
        }

        if (pages.Count == 1 && pages[0].CharCount == 0 && !string.IsNullOrWhiteSpace(map.Text))
        {
            var text = NormalizeWhitespace(map.Text);
            pages[0] = pages[0] with { CharCount = text.Length, Preview = Preview(text, 260), Text = text };
        }

        var sections = BuildSections(input.Position, pages, warnings);

        return new PdfReviewDocumentWork(
            DocumentId: $"document-{input.Position:000}",
            DisplayName: input.DisplayName,
            Sha256: await Sha256Async(input.Path, cancellationToken),
            PageCount: map.PageCount ?? pages.Count,
            Pages: pages,
            Sections: sections,
            Warnings: warnings.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
            ExtractionTruncated: map.Truncated,
            SectionFallbackUsed: sections.Any(section => section.Fallback));
    }

    private static IReadOnlyList<PdfReviewFinding> BuildFindings(
        string reviewType,
        IReadOnlyList<PdfReviewDocumentWork> documents,
        IReadOnlyList<PdfReviewSectionAlignment> alignments)
    {
        var findings = new List<PdfReviewFinding>();

        foreach (var document in documents)
        {
            AddProofreadingFindings(findings, reviewType, document);
            AddSingleDocumentConsistencyFindings(findings, reviewType, document);
        }

        if (documents.Count >= 2)
        {
            AddSectionAlignmentFindings(findings, documents, alignments);
        }

        if (findings.Count == 0 && documents.Any(document => document.Pages.Any(page => page.CharCount > 0)))
        {
            findings.Add(new PdfReviewFinding(
                Id: "finding-001",
                ReviewType: reviewType,
                Severity: "info",
                Category: "確認結果",
                DocumentId: documents[0].DocumentId,
                Page: documents[0].Pages.FirstOrDefault(page => page.CharCount > 0)?.Page ?? 1,
                Anchor: "page-summary",
                Evidence: documents[0].Pages.FirstOrDefault(page => page.CharCount > 0)?.Preview ?? "",
                Issue: "機械的に検出できる誤字や不整合は見つかりませんでした。",
                Suggestion: "重要資料では、固有名詞、数値、日付、表注記を人手でも確認してください。",
                Confidence: "low",
                Status: "human_review_recommended"));
        }

        return findings.Take(80).Select((finding, index) => finding with { Id = $"finding-{index + 1:000}" }).ToArray();
    }

    private static void AddProofreadingFindings(List<PdfReviewFinding> findings, string reviewType, PdfReviewDocumentWork document)
    {
        foreach (var page in document.Pages.Where(page => !string.IsNullOrWhiteSpace(page.Text)))
        {
            foreach (Match match in DuplicateWordRegex().Matches(page.Text).Take(8))
            {
                findings.Add(Finding(
                    reviewType,
                    "medium",
                    "重複語",
                    document.DocumentId,
                    page.Page,
                    match.Value,
                    EvidenceAround(page.Text, match.Index, match.Length),
                    $"同じ語が連続している可能性があります: {match.Value}",
                    "本文上の意図的な繰り返しかを確認し、不要なら片方を削除してください。",
                    "medium"));
            }

            foreach (Match match in RepeatedPunctuationRegex().Matches(page.Text).Take(8))
            {
                findings.Add(Finding(
                    reviewType,
                    "low",
                    "約物",
                    document.DocumentId,
                    page.Page,
                    match.Value,
                    EvidenceAround(page.Text, match.Index, match.Length),
                    $"句読点または記号が連続しています: {match.Value}",
                    "表記ルールに合わせて記号の数を確認してください。",
                    "medium"));
            }
        }
    }

    private static void AddSingleDocumentConsistencyFindings(List<PdfReviewFinding> findings, string reviewType, PdfReviewDocumentWork document)
    {
        var dates = ExtractTokens(document, DateRegex()).GroupBy(item => item.Token).ToArray();
        if (dates.Length > 8)
        {
            findings.Add(Finding(
                reviewType,
                "info",
                "日付の確認",
                document.DocumentId,
                dates[0].First().Page,
                dates[0].Key,
                string.Join(", ", dates.Take(12).Select(group => group.Key)),
                "文書内に複数の日付表記があります。",
                "基準日、発行日、対象期間が混在していないか確認してください。",
                "low"));
        }
    }

    private static void AddSectionAlignmentFindings(
        List<PdfReviewFinding> findings,
        IReadOnlyList<PdfReviewDocumentWork> documents,
        IReadOnlyList<PdfReviewSectionAlignment> alignments)
    {
        var documentsById = documents.ToDictionary(document => document.DocumentId, StringComparer.OrdinalIgnoreCase);
        foreach (var alignment in alignments.Take(80))
        {
            if (!documentsById.TryGetValue(alignment.BaseDocumentId, out var baseDocument))
            {
                continue;
            }

            var baseSection = baseDocument.Sections.FirstOrDefault(section => section.SectionId == alignment.BaseSectionId);
            if (baseSection is null)
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(alignment.ComparedDocumentId) || string.IsNullOrWhiteSpace(alignment.ComparedSectionId))
            {
                findings.Add(Finding(
                    "multi-document",
                    "low",
                    "対応未確認",
                    baseDocument.DocumentId,
                    baseSection.StartPage,
                    baseSection.Title,
                    baseSection.Preview,
                    $"「{baseSection.Title}」に対応する章・見出しが他PDFで明確に見つかりませんでした。",
                    "章構成の違いか、片方の記載漏れかを確認してください。",
                    "low"));
                continue;
            }

            if (!documentsById.TryGetValue(alignment.ComparedDocumentId, out var comparedDocument))
            {
                continue;
            }

            var comparedSection = comparedDocument.Sections.FirstOrDefault(section => section.SectionId == alignment.ComparedSectionId);
            if (comparedSection is null)
            {
                continue;
            }

            AddSectionDifferenceFindings(findings, baseDocument, comparedDocument, baseSection, comparedSection, DateRegex(), "日付");
            AddSectionDifferenceFindings(findings, baseDocument, comparedDocument, baseSection, comparedSection, AmountRegex(), "数値");
        }
    }

    private static void AddSectionDifferenceFindings(
        List<PdfReviewFinding> findings,
        PdfReviewDocumentWork leftDocument,
        PdfReviewDocumentWork rightDocument,
        PdfReviewSectionWork leftSection,
        PdfReviewSectionWork rightSection,
        Regex regex,
        string category)
    {
        var leftTokens = ExtractTokens(leftSection, regex)
            .GroupBy(item => item.Token)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var rightTokens = ExtractTokens(rightSection, regex)
            .GroupBy(item => item.Token)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var token in leftTokens.Keys.Except(rightTokens.Keys, StringComparer.OrdinalIgnoreCase).Take(4))
        {
            var leftHit = leftTokens[token];
            findings.Add(new PdfReviewFinding(
                Id: "",
                ReviewType: "multi-document",
                Severity: "medium",
                Category: $"{category}差分",
                DocumentId: leftDocument.DocumentId,
                Page: leftHit.Page,
                Anchor: token,
                Evidence: EvidenceAround(leftHit.Text, leftHit.Index, token.Length),
                Issue: $"{leftDocument.DisplayName} の「{leftSection.Title}」にある {category} が {rightDocument.DisplayName} の対応セクションでは確認できません。",
                Suggestion: "同じ意味の別表記か、対応セクションの更新漏れかを確認してください。",
                Confidence: "medium",
                Status: "candidate",
                ComparedDocumentId: rightDocument.DocumentId,
                ComparedPage: rightSection.StartPage,
                ComparedEvidence: rightSection.Preview));
        }

        foreach (var token in rightTokens.Keys.Except(leftTokens.Keys, StringComparer.OrdinalIgnoreCase).Take(4))
        {
            var rightHit = rightTokens[token];
            findings.Add(new PdfReviewFinding(
                Id: "",
                ReviewType: "multi-document",
                Severity: "medium",
                Category: $"{category}差分",
                DocumentId: rightDocument.DocumentId,
                Page: rightHit.Page,
                Anchor: token,
                Evidence: EvidenceAround(rightHit.Text, rightHit.Index, token.Length),
                Issue: $"{rightDocument.DisplayName} の「{rightSection.Title}」にある {category} が {leftDocument.DisplayName} の対応セクションでは確認できません。",
                Suggestion: "同じ意味の別表記か、対応セクションの更新漏れかを確認してください。",
                Confidence: "medium",
                Status: "candidate",
                ComparedDocumentId: leftDocument.DocumentId,
                ComparedPage: leftSection.StartPage,
                ComparedEvidence: leftSection.Preview));
        }
    }

    private static IReadOnlyList<TokenHit> ExtractTokens(PdfReviewDocumentWork document, Regex regex)
    {
        var hits = new List<TokenHit>();
        foreach (var page in document.Pages)
        {
            foreach (Match match in regex.Matches(page.Text).Take(80))
            {
                hits.Add(new TokenHit(match.Value, page.Page, page.Text, match.Index));
            }
        }
        return hits;
    }

    private static IReadOnlyList<TokenHit> ExtractTokens(PdfReviewSectionWork section, Regex regex)
    {
        var hits = new List<TokenHit>();
        foreach (Match match in regex.Matches(section.Text).Take(80))
        {
            hits.Add(new TokenHit(match.Value, section.StartPage, section.Text, match.Index));
        }
        return hits;
    }

    private static IReadOnlyList<PdfReviewSectionWork> BuildSections(
        int documentPosition,
        IReadOnlyList<PdfReviewPageWork> pages,
        List<string> warnings)
    {
        var textPages = pages.Where(page => !string.IsNullOrWhiteSpace(page.Text)).ToArray();
        if (textPages.Length == 0)
        {
            return [];
        }

        var headingStarts = textPages
            .SelectMany(page => ExtractHeadingCandidates(page))
            .GroupBy(candidate => candidate.Page)
            .Select(group => group.OrderByDescending(candidate => candidate.Score).First())
            .OrderBy(candidate => candidate.Page)
            .ToArray();

        if (headingStarts.Length > 0)
        {
            var sections = new List<PdfReviewSectionWork>();
            for (var index = 0; index < headingStarts.Length; index += 1)
            {
                var start = headingStarts[index];
                var nextPage = index + 1 < headingStarts.Length ? headingStarts[index + 1].Page : textPages[^1].Page + 1;
                var endPage = Math.Max(start.Page, nextPage - 1);
                var text = TextForPageRange(textPages, start.Page, endPage);
                sections.Add(NewSection(documentPosition, sections.Count + 1, start.Title, start.Page, endPage, text, fallback: false));
            }

            return sections;
        }

        if (textPages.Length > FallbackSectionPageWindow)
        {
            AddDistinct(warnings, "No clear chapter headings were detected; Relay split the PDF into bounded page-range sections.");
        }

        var fallbackSections = new List<PdfReviewSectionWork>();
        for (var startIndex = 0; startIndex < textPages.Length; startIndex += FallbackSectionPageWindow)
        {
            var group = textPages.Skip(startIndex).Take(FallbackSectionPageWindow).ToArray();
            var startPage = group[0].Page;
            var endPage = group[^1].Page;
            var title = startPage == endPage ? $"Page {startPage}" : $"Pages {startPage}-{endPage}";
            fallbackSections.Add(NewSection(
                documentPosition,
                fallbackSections.Count + 1,
                title,
                startPage,
                endPage,
                TextForPageRange(textPages, startPage, endPage),
                fallback: true));
        }
        return fallbackSections;
    }

    private static IEnumerable<HeadingCandidate> ExtractHeadingCandidates(PdfReviewPageWork page)
    {
        var lines = page.Text
            .Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(line => NormalizeWhitespace(line))
            .Where(line => line.Length is >= 2 and <= 96)
            .Take(80);

        foreach (var line in lines)
        {
            if (HeadingNumberRegex().IsMatch(line))
            {
                yield return new HeadingCandidate(page.Page, line, 100);
                continue;
            }

            if (line.Length <= 42 && HeadingKeywordRegex().IsMatch(line) && !SentenceEndRegex().IsMatch(line))
            {
                yield return new HeadingCandidate(page.Page, line, 64);
            }
        }
    }

    private static PdfReviewSectionWork NewSection(
        int documentPosition,
        int sectionPosition,
        string title,
        int startPage,
        int endPage,
        string text,
        bool fallback)
    {
        var sectionText = NormalizeWhitespace(text);
        return new PdfReviewSectionWork(
            SectionId: $"section-{documentPosition:000}-{sectionPosition:000}",
            Title: Preview(title, 90),
            StartPage: startPage,
            EndPage: endPage,
            Text: sectionText,
            Preview: Preview(sectionText, 300),
            CharCount: sectionText.Length,
            Fallback: fallback);
    }

    private static string TextForPageRange(IReadOnlyList<PdfReviewPageWork> pages, int startPage, int endPage)
    {
        var builder = new StringBuilder();
        foreach (var page in pages.Where(page => page.Page >= startPage && page.Page <= endPage))
        {
            if (builder.Length > 0) builder.AppendLine();
            builder.AppendLine($"Page {page.Page}");
            builder.AppendLine(page.Text);
        }
        return builder.ToString();
    }

    private static IReadOnlyList<PdfReviewSectionAlignment> BuildSectionAlignments(IReadOnlyList<PdfReviewDocumentWork> documents)
    {
        if (documents.Count < 2 || documents[0].Sections.Count == 0)
        {
            return [];
        }

        var alignments = new List<PdfReviewSectionAlignment>();
        var baseDocument = documents[0];
        foreach (var comparedDocument in documents.Skip(1))
        {
            var usedComparedSections = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var baseSection in baseDocument.Sections.Take(80))
            {
                var scored = comparedDocument.Sections
                    .Where(section => !usedComparedSections.Contains(section.SectionId))
                    .Select(section => new { Section = section, Score = SectionSimilarity(baseSection, section) })
                    .OrderByDescending(item => item.Score)
                    .FirstOrDefault();

                if (scored is null || scored.Score < 28)
                {
                    alignments.Add(NewAlignment(alignments.Count + 1, baseDocument, baseSection, comparedDocument, null, 0, "unmatched_base"));
                    continue;
                }

                usedComparedSections.Add(scored.Section.SectionId);
                alignments.Add(NewAlignment(
                    alignments.Count + 1,
                    baseDocument,
                    baseSection,
                    comparedDocument,
                    scored.Section,
                    scored.Score,
                    scored.Score >= 52 ? "aligned" : "low_confidence"));
            }

            foreach (var extraSection in comparedDocument.Sections.Where(section => !usedComparedSections.Contains(section.SectionId)).Take(30))
            {
                alignments.Add(NewAlignment(alignments.Count + 1, comparedDocument, extraSection, baseDocument, null, 0, "unmatched_compared"));
            }
        }

        return alignments.Take(180).ToArray();
    }

    private static PdfReviewSectionAlignment NewAlignment(
        int position,
        PdfReviewDocumentWork baseDocument,
        PdfReviewSectionWork baseSection,
        PdfReviewDocumentWork comparedDocument,
        PdfReviewSectionWork? comparedSection,
        int score,
        string status) =>
        new(
            AlignmentId: $"alignment-{position:000}",
            BaseDocumentId: baseDocument.DocumentId,
            BaseSectionId: baseSection.SectionId,
            BaseTitle: baseSection.Title,
            BasePageStart: baseSection.StartPage,
            BasePageEnd: baseSection.EndPage,
            ComparedDocumentId: comparedDocument.DocumentId,
            ComparedSectionId: comparedSection?.SectionId,
            ComparedTitle: comparedSection?.Title,
            ComparedPageStart: comparedSection?.StartPage,
            ComparedPageEnd: comparedSection?.EndPage,
            Score: score,
            Status: status);

    private static int SectionSimilarity(PdfReviewSectionWork left, PdfReviewSectionWork right)
    {
        var titleScore = TextSimilarity(left.Title, right.Title);
        var bodyScore = TextSimilarity(left.Preview, right.Preview);
        return Math.Clamp((int)Math.Round(titleScore * 68 + bodyScore * 32), 0, 100);
    }

    private static double TextSimilarity(string left, string right)
    {
        var leftTokens = TokenizeForSimilarity(left);
        var rightTokens = TokenizeForSimilarity(right);
        if (leftTokens.Count == 0 || rightTokens.Count == 0)
        {
            return 0;
        }
        var intersection = leftTokens.Intersect(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        var union = leftTokens.Union(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        var jaccard = union == 0 ? 0 : (double)intersection / union;
        if (NormalizeForComparison(left).Equals(NormalizeForComparison(right), StringComparison.OrdinalIgnoreCase))
        {
            return 1;
        }
        if (NormalizeForComparison(left).Contains(NormalizeForComparison(right), StringComparison.OrdinalIgnoreCase) ||
            NormalizeForComparison(right).Contains(NormalizeForComparison(left), StringComparison.OrdinalIgnoreCase))
        {
            return Math.Max(jaccard, 0.72);
        }
        return jaccard;
    }

    private static HashSet<string> TokenizeForSimilarity(string value)
    {
        var normalized = NormalizeForComparison(value);
        var tokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in SimilarityTokenRegex().Matches(normalized))
        {
            var token = match.Value;
            if (token.Length >= 2 && !SimilarityStopWords().Contains(token))
            {
                tokens.Add(token);
            }
        }
        return tokens;
    }

    private static string NormalizeForComparison(string value) =>
        Regex.Replace(value.ToLowerInvariant(), @"\s+", " ").Trim();

    private static PdfReviewFinding Finding(
        string reviewType,
        string severity,
        string category,
        string documentId,
        int page,
        string anchor,
        string evidence,
        string issue,
        string suggestion,
        string confidence) =>
        new(
            Id: "",
            ReviewType: reviewType,
            Severity: severity,
            Category: category,
            DocumentId: documentId,
            Page: page,
            Anchor: anchor,
            Evidence: evidence,
            Issue: issue,
            Suggestion: suggestion,
            Confidence: confidence,
            Status: "candidate");

    private static string BuildMarkdownReport(
        string jobId,
        string reviewType,
        IReadOnlyList<PdfReviewDocument> documents,
        IReadOnlyList<PdfReviewSectionAlignment> alignments,
        IReadOnlyList<PdfReviewFinding> findings,
        IReadOnlyList<string> limitations)
    {
        var builder = new StringBuilder();
        builder.AppendLine("# Relay PDF Review Report");
        builder.AppendLine();
        builder.AppendLine($"- Job: `{jobId}`");
        builder.AppendLine($"- Review type: `{reviewType}`");
        builder.AppendLine($"- Documents: {documents.Count}");
        builder.AppendLine($"- Findings: {findings.Count}");
        builder.AppendLine();
        builder.AppendLine("## Documents");
        foreach (var document in documents)
        {
            builder.AppendLine($"- `{document.DocumentId}` {document.DisplayName} ({document.PageCount} pages)");
            foreach (var section in document.Sections.Take(20))
            {
                builder.AppendLine($"  - `{section.SectionId}` p.{section.StartPage}-{section.EndPage}: {section.Title}");
            }
            if (document.Sections.Count > 20)
            {
                builder.AppendLine($"  - ... {document.Sections.Count - 20} more sections");
            }
        }
        if (alignments.Count > 0)
        {
            builder.AppendLine();
            builder.AppendLine("## Section Correspondence");
            foreach (var alignment in alignments.Take(60))
            {
                var compared = string.IsNullOrWhiteSpace(alignment.ComparedSectionId)
                    ? "(no clear counterpart)"
                    : $"`{alignment.ComparedSectionId}` {alignment.ComparedTitle} p.{alignment.ComparedPageStart}-{alignment.ComparedPageEnd}";
                builder.AppendLine(
                    $"- `{alignment.AlignmentId}` {alignment.Status} score={alignment.Score}: " +
                    $"`{alignment.BaseSectionId}` {alignment.BaseTitle} p.{alignment.BasePageStart}-{alignment.BasePageEnd} -> {compared}");
            }
        }
        builder.AppendLine();
        builder.AppendLine("## Findings");
        if (findings.Count == 0)
        {
            builder.AppendLine("- No findings.");
        }
        foreach (var finding in findings)
        {
            builder.AppendLine($"### {finding.Id}: {finding.Category} ({finding.Severity})");
            builder.AppendLine($"- Document: `{finding.DocumentId}` page {finding.Page}");
            if (!string.IsNullOrWhiteSpace(finding.ComparedDocumentId))
            {
                builder.AppendLine($"- Compared with: `{finding.ComparedDocumentId}`");
            }
            builder.AppendLine($"- Evidence: {finding.Evidence}");
            builder.AppendLine($"- Issue: {finding.Issue}");
            builder.AppendLine($"- Suggestion: {finding.Suggestion}");
            builder.AppendLine();
        }
        builder.AppendLine("## Limitations");
        if (limitations.Count == 0)
        {
            builder.AppendLine("- Text-layer extraction completed without reported limitations.");
        }
        foreach (var limitation in limitations)
        {
            builder.AppendLine($"- {limitation}");
        }
        return builder.ToString();
    }

    private PdfReviewJobHandle CreateJobDirectory()
    {
        var jobId = $"pdf-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{RandomNumberGenerator.GetHexString(6).ToLowerInvariant()}";
        var directory = Path.Combine(_jobsRoot, jobId);
        Directory.CreateDirectory(directory);
        return new PdfReviewJobHandle(jobId, directory);
    }

    private string JobJsonPath(string jobId)
    {
        EnsureSafeJobId(jobId);
        return Path.Combine(_jobsRoot, jobId, "job.json");
    }

    private string ReportPath(string jobId)
    {
        EnsureSafeJobId(jobId);
        return Path.Combine(_jobsRoot, jobId, "report.md");
    }

    private static void EnsureSafeJobId(string jobId)
    {
        if (!IsSafeJobId(jobId)) throw new InvalidOperationException("Invalid PDF review job id.");
    }

    private static bool IsSafeJobId(string jobId) =>
        Regex.IsMatch(jobId, @"^pdf-[0-9]{14}-[a-f0-9]{6}$", RegexOptions.CultureInvariant);

    private static string NormalizeReviewType(string? value)
    {
        var normalized = (value ?? "auto").Trim().ToLowerInvariant();
        return normalized is "auto" or "proofread" or "consistency" or "compare" ? normalized : "auto";
    }

    private static string ResolveReviewType(string reviewType, int documentCount)
    {
        if (reviewType == "auto")
        {
            return documentCount >= 2 ? "multi-document" : "single-document";
        }
        return reviewType == "compare" && documentCount >= 2 ? "multi-document" : reviewType;
    }

    private static bool IsPdfName(string value) =>
        string.Equals(Path.GetExtension(value), ".pdf", StringComparison.OrdinalIgnoreCase);

    private static string SafeFileName(string value)
    {
        var name = Path.GetFileName(value);
        foreach (var invalid in Path.GetInvalidFileNameChars())
        {
            name = name.Replace(invalid, '_');
        }
        return string.IsNullOrWhiteSpace(name) ? $"document-{RandomNumberGenerator.GetHexString(4)}.pdf" : name;
    }

    private static async Task<string> Sha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string NormalizeWhitespace(string value) =>
        Regex.Replace(value.Replace("\u0000", ""), @"[ \t\r\f\v]+", " ").Trim();

    private static string Preview(string value, int maxLength)
    {
        var normalized = NormalizeWhitespace(value);
        return normalized.Length <= maxLength ? normalized : normalized[..maxLength] + "...";
    }

    private static string EvidenceAround(string text, int index, int length)
    {
        var start = Math.Max(0, index - 90);
        var end = Math.Min(text.Length, index + length + 90);
        return Preview(text[start..end], 240);
    }

    private static void AddDistinct(List<string> values, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        if (!values.Contains(value, StringComparer.OrdinalIgnoreCase)) values.Add(value);
    }

    [GeneratedRegex(@"\b(?<word>[\p{L}\p{N}]{2,})\s+\k<word>\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DuplicateWordRegex();

    [GeneratedRegex(@"([。、,.!?！？])\1+", RegexOptions.CultureInvariant)]
    private static partial Regex RepeatedPunctuationRegex();

    [GeneratedRegex(@"\b(?:20|19)\d{2}[/-]\d{1,2}[/-]\d{1,2}\b|\b(?:20|19)\d{2}年\d{1,2}月\d{1,2}日\b", RegexOptions.CultureInvariant)]
    private static partial Regex DateRegex();

    [GeneratedRegex(@"(?:[￥¥]\s*)?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:百万円|千円|円|%)", RegexOptions.CultureInvariant)]
    private static partial Regex AmountRegex();

    [GeneratedRegex(@"^(?:第[一二三四五六七八九十0-9０-９]+[章節部]|[0-9０-９]+(?:[.\-．ー][0-9０-９]+)*[.)）．、\s]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)）．、\s]+|[A-Z][.)]\s+).{1,90}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HeadingNumberRegex();

    [GeneratedRegex(@"(?:概要|目的|対象|範囲|結果|結論|方針|前提|注記|補足|変更点|差分|比較|整合|リスク|売上|損益|資産|負債|Summary|Overview|Scope|Result|Conclusion|Note|Risk|Change)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HeadingKeywordRegex();

    [GeneratedRegex(@"[。.!?！？]$", RegexOptions.CultureInvariant)]
    private static partial Regex SentenceEndRegex();

    [GeneratedRegex(@"[\p{L}\p{N}]+", RegexOptions.CultureInvariant)]
    private static partial Regex SimilarityTokenRegex();

    private static HashSet<string> SimilarityStopWords() =>
        new(StringComparer.OrdinalIgnoreCase)
        {
            "page",
            "pages",
            "section",
            "the",
            "and",
            "for",
            "with",
            "this",
            "that",
            "について",
            "する",
            "ある",
            "いる",
            "及び",
            "または",
        };

    private sealed record PdfReviewJobHandle(string JobId, string Directory);

    private sealed record PdfReviewInput(string Path, string DisplayName, int Position);

    private sealed record TokenHit(string Token, int Page, string Text, int Index);

    private sealed record HeadingCandidate(int Page, string Title, int Score);

    private sealed record PdfReviewDocumentWork(
        string DocumentId,
        string DisplayName,
        string Sha256,
        int PageCount,
        IReadOnlyList<PdfReviewPageWork> Pages,
        IReadOnlyList<PdfReviewSectionWork> Sections,
        IReadOnlyList<string> Warnings,
        bool ExtractionTruncated,
        bool SectionFallbackUsed)
    {
        public PdfReviewDocument ToPublic() =>
            new(
                DocumentId,
                DisplayName,
                Sha256,
                PageCount,
                Pages.Select(page => page.ToPublic()).ToArray(),
                Sections.Select(section => section.ToPublic()).ToArray(),
                Warnings,
                ExtractionTruncated);
    }

    private sealed record PdfReviewPageWork(
        int Page,
        int CharCount,
        string Preview,
        string Text)
    {
        public PdfReviewPage ToPublic() => new(Page, CharCount, Preview, CharCount > 0);
    }

    private sealed record PdfReviewSectionWork(
        string SectionId,
        string Title,
        int StartPage,
        int EndPage,
        string Text,
        string Preview,
        int CharCount,
        bool Fallback)
    {
        public PdfReviewSection ToPublic() => new(SectionId, Title, StartPage, EndPage, Preview, CharCount);
    }
}

public sealed record PdfReviewPathRequest(string ReviewType, IReadOnlyList<string> Paths);

public sealed record PdfReviewCapabilities(
    string SchemaVersion,
    IReadOnlyList<string> ReviewTypes,
    IReadOnlyList<string> SupportedFileTypes,
    int MaxDocuments,
    string Storage,
    IReadOnlyList<string> Limitations);

public sealed record PdfReviewJobResponse(
    string SchemaVersion,
    string JobId,
    string Status,
    string ReviewType,
    DateTimeOffset CreatedAt,
    IReadOnlyList<PdfReviewDocument> Documents,
    IReadOnlyList<PdfReviewFinding> Findings,
    IReadOnlyList<PdfReviewSectionAlignment> SectionAlignments,
    IReadOnlyList<string> Limitations,
    string ReportMarkdown);

public sealed record PdfReviewDocument(
    string DocumentId,
    string DisplayName,
    string Sha256,
    int PageCount,
    IReadOnlyList<PdfReviewPage> Pages,
    IReadOnlyList<PdfReviewSection> Sections,
    IReadOnlyList<string> Warnings,
    bool ExtractionTruncated);

public sealed record PdfReviewPage(
    int Page,
    int CharCount,
    string Preview,
    bool HasText);

public sealed record PdfReviewSection(
    string SectionId,
    string Title,
    int StartPage,
    int EndPage,
    string Preview,
    int CharCount);

public sealed record PdfReviewSectionAlignment(
    string AlignmentId,
    string BaseDocumentId,
    string BaseSectionId,
    string BaseTitle,
    int BasePageStart,
    int BasePageEnd,
    string ComparedDocumentId,
    string? ComparedSectionId,
    string? ComparedTitle,
    int? ComparedPageStart,
    int? ComparedPageEnd,
    int Score,
    string Status);

public sealed record PdfReviewFinding(
    string Id,
    string ReviewType,
    string Severity,
    string Category,
    string DocumentId,
    int Page,
    string Anchor,
    string Evidence,
    string Issue,
    string Suggestion,
    string Confidence,
    string Status,
    string? ComparedDocumentId = null,
    int? ComparedPage = null,
    string? ComparedEvidence = null);
