import * as React from "react";
import { describe, it, expect, vi } from "vitest";

import { ImageFieldRenderer, type ImageFieldValue } from "../src/components/ImageFieldRenderer.js";
import { render } from "./utils/render.tsx";

describe("ImageFieldRenderer alt/caption", () => {
	it("renders alt text and caption inputs for a selected image", async () => {
		const onChange = vi.fn();
		const value: ImageFieldValue = {
			id: "media_01",
			provider: "local",
			filename: "photo.jpg",
			mimeType: "image/jpeg",
			alt: "Selected alt",
			caption: "Selected caption",
			meta: { storageKey: "photo.jpg" },
		};

		const screen = await render(
			<ImageFieldRenderer label="Hero image" value={value} onChange={onChange} />,
		);

		const altInput = screen.getByRole("textbox", { name: "Alt text" });
		const captionInput = screen.getByRole("textbox", { name: "Caption" });
		await expect.element(altInput).toHaveValue("Selected alt");
		await expect.element(captionInput).toHaveValue("Selected caption");
	});

	it("updates the field value when alt text changes", async () => {
		const onChange = vi.fn();
		const value: ImageFieldValue = {
			id: "media_01",
			provider: "local",
			filename: "photo.jpg",
			mimeType: "image/jpeg",
			alt: "",
			caption: "",
			meta: { storageKey: "photo.jpg" },
		};

		const screen = await render(
			<ImageFieldRenderer label="Hero image" value={value} onChange={onChange} />,
		);

		const altInput = screen.getByRole("textbox", { name: "Alt text" });
		await altInput.fill("New alt");

		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ alt: "New alt", caption: "" }));
	});

	it("updates the field value when caption changes", async () => {
		const onChange = vi.fn();
		const value: ImageFieldValue = {
			id: "media_01",
			provider: "local",
			filename: "photo.jpg",
			mimeType: "image/jpeg",
			alt: "Alt",
			caption: "",
			meta: { storageKey: "photo.jpg" },
		};

		const screen = await render(
			<ImageFieldRenderer label="Hero image" value={value} onChange={onChange} />,
		);

		const captionInput = screen.getByRole("textbox", { name: "Caption" });
		await captionInput.fill("Photo credit: Author");

		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ alt: "Alt", caption: "Photo credit: Author" }),
		);
	});
});
