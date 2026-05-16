using System.Runtime.CompilerServices;
using Microsoft.Extensions.AI;

public sealed class RelayCopilotChatClient(ICopilotTransport transport) : IChatClient
{
    private static readonly ChatClientMetadata Metadata = new(
        providerName: "m365-copilot",
        providerUri: new Uri("https://m365.cloud.microsoft/chat"),
        defaultModelId: "m365-copilot");

    public async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var prompt = BuildPrompt(messages, options);
        if (string.IsNullOrWhiteSpace(prompt))
        {
            throw new InvalidOperationException("RelayCopilotChatClient requires at least one non-empty chat message.");
        }

        var response = await transport.SendAsync(prompt, cancellationToken);
        return new ChatResponse(new ChatMessage(ChatRole.Assistant, response))
        {
            ModelId = options?.ModelId ?? Metadata.DefaultModelId,
        };
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var response = await GetResponseAsync(messages, options, cancellationToken);
        yield return new ChatResponseUpdate(ChatRole.Assistant, response.Text);
    }

    public object? GetService(Type serviceType, object? serviceKey = null)
    {
        ArgumentNullException.ThrowIfNull(serviceType);
        if (serviceKey is not null) return null;
        if (serviceType == typeof(ChatClientMetadata)) return Metadata;
        if (serviceType.IsInstanceOfType(this)) return this;
        return null;
    }

    public void Dispose()
    {
        // The CDP transport is owned by the sidecar lifetime, not this adapter.
    }

    private static string BuildPrompt(IEnumerable<ChatMessage> messages, ChatOptions? options)
    {
        var messageList = messages.Where(message => !string.IsNullOrWhiteSpace(message.Text)).ToArray();
        if (string.IsNullOrWhiteSpace(options?.Instructions) && messageList.Length == 1)
        {
            return messageList[0].Text;
        }

        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(options?.Instructions))
        {
            parts.Add(options.Instructions);
        }

        foreach (var message in messageList)
        {
            parts.Add($"{message.Role.Value}: {message.Text}");
        }

        return string.Join("\n\n", parts);
    }
}
