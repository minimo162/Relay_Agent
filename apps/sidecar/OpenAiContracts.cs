using System.Text.Json.Serialization;

public sealed record OpenAiChatCompletionRequest(
    [property: JsonPropertyName("model")] string? Model,
    [property: JsonPropertyName("messages")] IReadOnlyList<OpenAiChatMessage> Messages)
{
    public string LastUserMessage() =>
        Messages.LastOrDefault(message => string.Equals(message.Role, "user", StringComparison.OrdinalIgnoreCase))?.Content ?? "";
}

public sealed record OpenAiChatMessage(
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("content")] string Content);

public sealed record OpenAiChatCompletionResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("object")] string Object,
    [property: JsonPropertyName("created")] long Created,
    [property: JsonPropertyName("model")] string Model,
    [property: JsonPropertyName("choices")] IReadOnlyList<OpenAiChoice> Choices)
{
    public static OpenAiChatCompletionResponse FromText(string model, string text) =>
        new(
            Id: $"chatcmpl-relay-{Guid.NewGuid():N}",
            Object: "chat.completion",
            Created: DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            Model: model,
            Choices:
            [
                new OpenAiChoice(
                    Index: 0,
                    Message: new OpenAiChatMessage("assistant", text),
                    FinishReason: "stop"),
            ]);
}

public sealed record OpenAiChoice(
    [property: JsonPropertyName("index")] int Index,
    [property: JsonPropertyName("message")] OpenAiChatMessage Message,
    [property: JsonPropertyName("finish_reason")] string FinishReason);
