import { writable } from "svelte/store";

type Message = {
    user: boolean;
    text: string;
};

export const chatUserInput = writable(
    Array<Message>(
        { user: true, text: "Hi What's up?" },
        { user: false, text: "Nothing much" },
        { user: true, text: "How are you?" },
        { user: false, text: "I'm good" },
        { user: true, text: "That's great" },
        { user: false, text: "Yeah" },
        { user: true, text: "Adios" },
        { user: false, text: "Bye" }
    )
);
