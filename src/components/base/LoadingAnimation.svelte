<div class="loader"></div>

<style>
    .loader {
        color: #000;
        width: 4px;
        aspect-ratio: 1;
        border-radius: 50%;
        box-shadow:
            19px 0 0 7px,
            38px 0 0 3px,
            57px 0 0 0;
        transform: translateX(-38px);
        animation: l21 0.5s infinite alternate linear;
    }

    @keyframes l21 {
        50% {
            box-shadow:
                19px 0 0 3px,
                38px 0 0 7px,
                57px 0 0 3px;
        }
        100% {
            box-shadow:
                19px 0 0 0,
                38px 0 0 3px,
                57px 0 0 7px;
        }
    }
</style>
