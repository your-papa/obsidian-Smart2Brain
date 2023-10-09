import type { Message } from './store';

export async function stallAsyncFunction(delay: number): Promise<void> {
    // Use setTimeout to pause the execution for the specified delay
    await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function processMessageWithStall(message: Message): Promise<Message> {
    console.log('Process was called');

    // Stall for 2 seconds (you can adjust the delay as needed)
    await stallAsyncFunction(5000);

    const response = await fetch('https://api.quotable.io/random');
    const data = await response.json();
    return { role: 'assistant', content: data.content };
}

export async function processMessage(message: Message): Promise<Message> {
    console.log('Process was called');
    const response = await fetch('https://api.quotable.io/random');
    const data = await response.json();
    return { role: 'assistant', content: data.content };
}
