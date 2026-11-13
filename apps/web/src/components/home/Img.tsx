/* eslint-disable @next/next/no-img-element -- small static webp art from /public/home, laid out exactly like the prototype's <img> (object-fit, absolute hero layers); next/image adds wrappers that change that layout. */
import type { ImgHTMLAttributes } from "react";

/** Decorative image (empty alt unless given). */
export function Img({ alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return <img alt={alt} decoding="async" {...props} />;
}
