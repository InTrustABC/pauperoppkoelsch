import { defineCollection, z } from "astro:content";
import { glob, file } from 'astro/loaders';
const postsCollection = defineCollection({
    schema: ({ image }) => z.object({
        author: z.string(),
        date: z.coerce.date(),
        image: image(),
        title: z.string(),
    })
})

export const collections = {
    posts: postsCollection
}