"""Нормализация ссылок на фото и гипертекст."""
from __future__ import annotations

import unittest

from public_urls import media_url, rewrite_media_urls_in_html, to_public_media_url


class PublicUrlTests(unittest.TestCase):
    def test_builds_relative_media_url(self):
        self.assertEqual(media_url("image", "abc-id"), "/api/db/image/abc-id")
        self.assertEqual(media_url("hyper-text", "abc-id"), "/api/db/hyper-text/abc-id")
        self.assertEqual(media_url("avatar", "abc-id"), "/api/db/avatar/abc-id")

    def test_already_relative(self):
        self.assertEqual(to_public_media_url("/api/db/image/abc"), "/api/db/image/abc")

    def test_strips_localhost_and_ip(self):
        self.assertEqual(
            to_public_media_url("http://localhost/api/db/image/abc"),
            "/api/db/image/abc",
        )
        self.assertEqual(
            to_public_media_url("http://192.168.1.10:80/api/db/hyper-text/abc"),
            "/api/db/hyper-text/abc",
        )
        self.assertEqual(
            to_public_media_url("https://foodtinder.ru/api/db/avatar/abc"),
            "/api/db/avatar/abc",
        )

    def test_keeps_external_photos(self):
        src = "https://eda.ru/img/photo.jpg"
        self.assertEqual(to_public_media_url(src), src)

    def test_empty(self):
        self.assertIsNone(to_public_media_url(None))
        self.assertEqual(to_public_media_url(""), "")
        self.assertEqual(to_public_media_url("  "), "")

    def test_rewrites_host_in_html(self):
        html = (
            '<img src="http://localhost/api/db/image/abc" alt="Шаг 1">'
            '<a href="https://192.168.0.5/api/db/image/def">x</a>'
            '<img src="https://eda.ru/img/p.jpg">'
        )
        out = rewrite_media_urls_in_html(html)
        self.assertIn('src="/api/db/image/abc"', out)
        self.assertIn('href="/api/db/image/def"', out)
        self.assertIn('src="https://eda.ru/img/p.jpg"', out)
        self.assertNotIn("localhost", out)
        self.assertNotIn("192.168.0.5", out)


if __name__ == "__main__":
    unittest.main()
