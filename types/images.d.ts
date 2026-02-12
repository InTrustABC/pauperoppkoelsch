declare module '*.jpg' {
    const src: Image;
    export default src;
}

declare module '*.jpeg' {
    const src: Image;
    export default src;
}

declare module '*.png' {
    const src: Image;
    export default src;
}

declare module '*.gif' {
    const src: string;
    export default src;
}

declare module '*.svg' {
    const src: string;
    export default src;
}

declare module '*.webp' {
    const src: string;
    export default src;
}

declare module '*.avif' {
    const src: string;
    export default src;
}

// Support uppercase extensions sometimes present on macOS
declare module '*.JPG' {
    const src: Image;
    export default src;
}

declare module '*.JPEG' {
    const src: Image;
    export default src;
}

declare module '*.PNG' {
    const src: string;
    export default src;
}

declare module '*.GIF' {
    const src: string;
    export default src;
}

declare module '*.SVG' {
    const src: string;
    export default src;
}
