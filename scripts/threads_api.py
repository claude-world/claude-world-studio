#!/usr/bin/env python3
"""
Threads API Client — Full lifecycle: search, analyze, generate, publish.
Based on Meta's official Threads API (graph.threads.net/v1.0).

Supports ALL Threads post types and features:
  - Media: TEXT, IMAGE, VIDEO, CAROUSEL (2-20 items)
  - Attachments: poll, GIF (GIPHY), link preview, text attachment (10k chars)
  - Spoiler: media blur (is_spoiler_media) + text spoiler (text_entities)
  - Ghost post: 24hr ephemeral posts
  - Quote post: quote another post
  - Reply control: everyone / accounts_you_follow / mentioned_only /
                   parent_post_author_only / followers_only
  - Topic tag, alt text, link comment (auto-reply)
  - Thread (串文), batch publish, scheduled publish

Tokens are auto-loaded from ../.env (relative to this script).
Use --account to select which account (cw or lf). --token overrides env.

Usage:
  python threads_api.py me
  python threads_api.py search --query "AI" --limit 20
  python threads_api.py publish --text "Hello" --topic-tag "AI"
  python threads_api.py publish --text "Look!" --image URL --spoiler-media
  python threads_api.py publish --text "Spoiler: ||secret text||" --spoiler-text "9:11"
  python threads_api.py publish --text "Pick one" --poll "A|B|C"
  python threads_api.py publish --text "Check this" --gif-id GIPHY_ID
  python threads_api.py publish --text "My take" --quote-post-id 12345
  python threads_api.py publish --text "Vanishes!" --ghost
  python threads_api.py publish --text "Long read" --text-attachment long.txt
  python threads_api.py publish --text "Caption" --carousel URL1 URL2 URL3
  python threads_api.py publish --text "Post" --reply-control mentioned_only
  python threads_api.py publish --text "Post" --link-attachment "https://example.com"
  python threads_api.py batch-publish --file posts.json --delay 1800
  python threads_api.py schedule --file posts.json --times "21:00,12:00"
"""

import argparse
import json
import sys
import time
import os
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.parse import urlencode, quote
from urllib.error import HTTPError


def load_env():
    """Load .env file from the skill root (one level up from scripts/)."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    env_path = os.path.normpath(env_path)
    if not os.path.isfile(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


load_env()


def resolve_token(args):
    """Resolve the API token from --token flag or environment variables."""
    if args.token:
        return args.token
    account = getattr(args, "account", "cw")
    if account == "lf":
        token = os.environ.get("THREADS_TOKEN_LF")
    else:
        token = os.environ.get("THREADS_TOKEN_CW")
    if not token:
        # Fallback to generic THREADS_ACCESS_TOKEN
        token = os.environ.get("THREADS_ACCESS_TOKEN")
    if not token:
        print("Error: No token provided. Use --token or set THREADS_TOKEN_CW / THREADS_TOKEN_LF in .env", file=sys.stderr)
        sys.exit(1)
    return token


API_BASE = "https://graph.threads.net/v1.0"

REPLY_CONTROL_VALUES = [
    "everyone", "accounts_you_follow", "mentioned_only",
    "parent_post_author_only", "followers_only",
]


class ThreadsAPI:
    def __init__(self, access_token: str):
        self.token = access_token
        self.user_id = None
        self.username = None
        self.rate_limit_remaining = None

    def _request(self, method: str, endpoint: str, params: dict = None, data: dict = None) -> dict:
        """Make an API request to Threads."""
        url = f"{API_BASE}{endpoint}"

        if params is None:
            params = {}
        params["access_token"] = self.token

        if method == "GET":
            url += "?" + urlencode(params)
            req = Request(url, method="GET")
        else:
            url += "?" + urlencode({"access_token": self.token})
            body = urlencode({k: v for k, v in (data or params).items() if k != "access_token"})
            req = Request(url, data=body.encode(), method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")

        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except HTTPError as e:
            error_body = e.read().decode()
            print(f"API Error {e.code}: {error_body}", file=sys.stderr)
            raise

    def _ensure_user(self):
        if not self.user_id:
            self.get_me()

    # ── Identity ──

    def get_me(self) -> dict:
        """Get current user profile."""
        data = self._request("GET", "/me", {
            "fields": "id,username,name,threads_profile_picture_url,threads_biography"
        })
        self.user_id = data.get("id")
        self.username = data.get("username", data.get("name", "unknown"))
        return data

    # ── Search ──

    def search(self, query: str, limit: int = 20) -> list:
        """
        Search Threads for posts matching a keyword.
        Returns posts sorted by heat score.
        Rate limit: 500 queries per rolling 7 days.
        """
        data = self._request("GET", "/keyword_search", {
            "q": query,
            "fields": "id,text,username,timestamp,like_count,reply_count,repost_count",
            "limit": str(min(limit, 50))
        })
        posts = data.get("data", [])

        # Calculate heat score for each post
        for post in posts:
            likes = post.get("like_count", 0) or 0
            replies = post.get("reply_count", 0) or 0
            reposts = post.get("repost_count", 0) or 0
            post["heat_score"] = likes + (replies * 3) + (reposts * 5)

        # Sort by heat score descending
        posts.sort(key=lambda p: p["heat_score"], reverse=True)
        return posts

    def search_multiple(self, queries: list, limit_per_query: int = 10) -> dict:
        """Search multiple keywords and return results grouped by query."""
        results = {}
        for q in queries:
            try:
                posts = self.search(q, limit_per_query)
                results[q] = posts
                time.sleep(1)  # Rate limit courtesy
            except Exception as e:
                print(f"Search failed for '{q}': {e}", file=sys.stderr)
                results[q] = []
        return results

    # ── Publishing: Container Creation ──

    def create_container(self, text: str = None, *,
                         image_url: str = None,
                         video_url: str = None,
                         reply_to: str = None,
                         poll_options: list = None,
                         link_attachment: str = None,
                         gif_id: str = None,
                         gif_provider: str = "GIPHY",
                         text_attachment: dict = None,
                         quote_post_id: str = None,
                         topic_tag: str = None,
                         alt_text: str = None,
                         reply_control: str = None,
                         is_spoiler_media: bool = False,
                         text_entities: list = None,
                         is_ghost_post: bool = False,
                         is_carousel_item: bool = False) -> str:
        """
        Create a media container for a Threads post.

        Supports all Threads API container parameters:
        - Media types: TEXT, IMAGE, VIDEO (auto-detected from urls)
        - Attachments (TEXT only): poll, gif, link_attachment, text_attachment
        - Content controls: reply_control, topic_tag, alt_text
        - Special: spoiler (media & text), ghost post, quote post
        - Carousel: set is_carousel_item=True for carousel children

        Returns the creation_id needed for publishing.
        """
        if text and len(text) > 500:
            print(f"WARNING: Text is {len(text)} chars, truncating to 500", file=sys.stderr)
            text = text[:497] + "..."

        self._ensure_user()

        # ── Determine media type and base params ──
        if is_carousel_item:
            if video_url:
                params = {"media_type": "VIDEO", "video_url": video_url, "is_carousel_item": "true"}
            elif image_url:
                params = {"media_type": "IMAGE", "image_url": image_url, "is_carousel_item": "true"}
            else:
                params = {"media_type": "TEXT", "is_carousel_item": "true"}
            if text:
                params["text"] = text
        elif video_url:
            params = {"media_type": "VIDEO", "video_url": video_url}
            if text:
                params["text"] = text
        elif image_url:
            params = {"media_type": "IMAGE", "image_url": image_url}
            if text:
                params["text"] = text
        else:
            params = {"media_type": "TEXT"}
            if text:
                params["text"] = text

        # ── Reply ──
        if reply_to:
            params["reply_to_id"] = reply_to

        # ── Attachments (TEXT type only, not for carousel items) ──
        if not image_url and not video_url and not is_carousel_item:
            if poll_options:
                poll = {}
                keys = ["option_a", "option_b", "option_c", "option_d"]
                for i, opt in enumerate(poll_options[:4]):
                    poll[keys[i]] = opt[:25]
                params["poll_attachment"] = json.dumps(poll)

            if link_attachment:
                params["link_attachment"] = link_attachment

            if gif_id:
                params["gif_attachment"] = json.dumps({
                    "gif_id": gif_id,
                    "provider": gif_provider,
                })

            if text_attachment:
                params["text_attachment"] = json.dumps(text_attachment)

            if is_ghost_post:
                params["is_ghost_post"] = "true"

        # ── Quote post ──
        if quote_post_id:
            params["quote_post_id"] = quote_post_id

        # ── Content controls ──
        if reply_control:
            params["reply_control"] = reply_control

        if topic_tag:
            params["topic_tag"] = topic_tag

        if alt_text:
            params["alt_text"] = alt_text

        # ── Spoiler ──
        if is_spoiler_media:
            params["is_spoiler_media"] = "true"

        if text_entities:
            params["text_entities"] = json.dumps(text_entities)

        data = self._request("POST", f"/{self.user_id}/threads", data=params)
        return data.get("id")

    def publish_container(self, creation_id: str) -> dict:
        """Publish a previously created media container."""
        self._ensure_user()
        data = self._request("POST", f"/{self.user_id}/threads_publish", data={
            "creation_id": creation_id
        })
        return data

    def check_container_status(self, container_id: str) -> dict:
        """Check the status of a media container (useful for video/carousel)."""
        return self._request("GET", f"/{container_id}", {
            "fields": "status,error_message"
        })

    def _wait_for_container(self, container_id: str, timeout: int = 60, poll_interval: int = 5):
        """Poll container status until FINISHED or timeout."""
        elapsed = 0
        while elapsed < timeout:
            status = self.check_container_status(container_id)
            s = status.get("status")
            if s == "FINISHED":
                return
            if s == "ERROR":
                raise Exception(f"Container error: {status.get('error_message', 'unknown')}")
            time.sleep(poll_interval)
            elapsed += poll_interval
        # If we time out, try publishing anyway — Meta sometimes doesn't return FINISHED
        print(f"  Container status poll timed out after {timeout}s, attempting publish", file=sys.stderr)

    # ── Publishing: High-level Methods ──

    def _post_link_reply(self, post_id: str, link_comment: str, output: dict):
        """Auto-reply with a link to avoid reach penalty from URL in main post."""
        time.sleep(3)
        try:
            reply_cid = self.create_container(link_comment, reply_to=post_id)
            time.sleep(5)
            reply_result = self.publish_container(reply_cid)
            output["link_reply_id"] = reply_result.get("id")
            print(f"  ✓ Link reply posted: {output['link_reply_id']}", file=sys.stderr)
        except Exception as e:
            output["link_reply_error"] = str(e)
            print(f"  ✗ Link reply failed: {e}", file=sys.stderr)

    def publish(self, text: str = None, *,
                image_url: str = None,
                video_url: str = None,
                poll_options: list = None,
                link_comment: str = None,
                link_attachment: str = None,
                gif_id: str = None,
                gif_provider: str = "GIPHY",
                text_attachment: dict = None,
                quote_post_id: str = None,
                topic_tag: str = None,
                alt_text: str = None,
                reply_control: str = None,
                is_spoiler_media: bool = False,
                text_entities: list = None,
                is_ghost_post: bool = False) -> dict:
        """
        Full publish flow: create container → wait → publish.

        Handles TEXT, IMAGE, VIDEO posts with all optional features.
        For CAROUSEL, use publish_carousel() instead.
        """
        container_id = self.create_container(
            text,
            image_url=image_url,
            video_url=video_url,
            poll_options=poll_options,
            link_attachment=link_attachment,
            gif_id=gif_id,
            gif_provider=gif_provider,
            text_attachment=text_attachment,
            quote_post_id=quote_post_id,
            topic_tag=topic_tag,
            alt_text=alt_text,
            reply_control=reply_control,
            is_spoiler_media=is_spoiler_media,
            text_entities=text_entities,
            is_ghost_post=is_ghost_post,
        )
        if not container_id:
            raise Exception("Failed to create media container")

        # Wait for processing — videos need more time
        if video_url:
            self._wait_for_container(container_id, timeout=120, poll_interval=5)
        else:
            time.sleep(5)

        result = self.publish_container(container_id)
        post_id = result.get("id")

        output = {
            "post_id": post_id,
            "container_id": container_id,
            "type": "video" if video_url else "image" if image_url else "text",
            "text_length": len(text) if text else 0,
            "published_at": datetime.now().isoformat(),
        }

        # Include notable options in output
        if poll_options:
            output["poll_options"] = poll_options[:4]
        if image_url:
            output["image_url"] = image_url
        if video_url:
            output["video_url"] = video_url
        if is_spoiler_media:
            output["spoiler_media"] = True
        if text_entities:
            output["text_entities"] = text_entities
        if is_ghost_post:
            output["ghost_post"] = True
        if quote_post_id:
            output["quote_post_id"] = quote_post_id
        if gif_id:
            output["gif_id"] = gif_id
        if topic_tag:
            output["topic_tag"] = topic_tag
        if reply_control:
            output["reply_control"] = reply_control
        if link_attachment:
            output["link_attachment"] = link_attachment

        # Auto-reply with link to avoid reach penalty
        if link_comment and post_id:
            self._post_link_reply(post_id, link_comment, output)

        return output

    # Backward-compatible alias
    def publish_text(self, text: str, image_url: str = None,
                     poll_options: list = None, link_comment: str = None,
                     **kwargs) -> dict:
        """Backward-compatible wrapper for publish()."""
        return self.publish(text, image_url=image_url, poll_options=poll_options,
                            link_comment=link_comment, **kwargs)

    def publish_carousel(self, text: str = None, media_urls: list = None, *,
                         topic_tag: str = None,
                         reply_control: str = None,
                         is_spoiler_media: bool = False,
                         text_entities: list = None,
                         quote_post_id: str = None,
                         alt_text: str = None,
                         link_comment: str = None) -> dict:
        """
        Publish a carousel post (2-20 items, mix of images and videos).

        media_urls: list of URL strings or dicts with 'url' and optional 'type' ('image'|'video').
                    URLs ending in .mp4/.mov are auto-detected as video.
        """
        if not media_urls or len(media_urls) < 2:
            raise ValueError("Carousel requires at least 2 media items")
        if len(media_urls) > 20:
            print(f"WARNING: Carousel has {len(media_urls)} items, truncating to 20", file=sys.stderr)
            media_urls = media_urls[:20]

        self._ensure_user()

        # Create individual carousel item containers
        children_ids = []
        for item in media_urls:
            if isinstance(item, str):
                url = item
                is_video = any(url.lower().endswith(ext) for ext in ('.mp4', '.mov'))
            else:
                url = item["url"]
                is_video = item.get("type") == "video" or any(url.lower().endswith(ext) for ext in ('.mp4', '.mov'))

            if is_video:
                cid = self.create_container(video_url=url, is_carousel_item=True)
            else:
                cid = self.create_container(image_url=url, is_carousel_item=True)
            children_ids.append(cid)
            time.sleep(2)

        # Create the carousel container
        params = {
            "media_type": "CAROUSEL",
            "children": ",".join(children_ids),
        }
        if text:
            if len(text) > 500:
                text = text[:497] + "..."
            params["text"] = text
        if topic_tag:
            params["topic_tag"] = topic_tag
        if reply_control:
            params["reply_control"] = reply_control
        if is_spoiler_media:
            params["is_spoiler_media"] = "true"
        if text_entities:
            params["text_entities"] = json.dumps(text_entities)
        if quote_post_id:
            params["quote_post_id"] = quote_post_id
        if alt_text:
            params["alt_text"] = alt_text

        data = self._request("POST", f"/{self.user_id}/threads", data=params)
        carousel_id = data.get("id")

        # Wait for all items to process
        self._wait_for_container(carousel_id, timeout=120, poll_interval=5)

        result = self.publish_container(carousel_id)
        post_id = result.get("id")

        output = {
            "post_id": post_id,
            "container_id": carousel_id,
            "type": "carousel",
            "items": len(children_ids),
            "text_length": len(text) if text else 0,
            "published_at": datetime.now().isoformat(),
        }
        if is_spoiler_media:
            output["spoiler_media"] = True
        if topic_tag:
            output["topic_tag"] = topic_tag

        if link_comment and post_id:
            self._post_link_reply(post_id, link_comment, output)

        return output

    def publish_thread(self, posts: list, **kwargs) -> list:
        """
        Publish a thread (串文) — a series of connected posts.
        First post is the parent, subsequent posts are replies.
        Extra kwargs are passed to the first post's publish() call.
        """
        results = []
        parent_id = None

        for i, text in enumerate(posts):
            if i == 0:
                result = self.publish(text, **kwargs)
                parent_id = result["post_id"]
            else:
                container_id = self.create_container(text, reply_to=parent_id)
                time.sleep(5)
                pub = self.publish_container(container_id)
                result = {
                    "post_id": pub.get("id"),
                    "container_id": container_id,
                    "text_length": len(text),
                    "reply_to": parent_id,
                    "published_at": datetime.now().isoformat()
                }

            results.append(result)
            time.sleep(3)  # Brief pause between thread posts

        return results

    def batch_publish(self, posts: list, delay_seconds: int = 1800) -> list:
        """
        Publish multiple independent posts with delay between each.
        Default delay: 30 minutes (1800 seconds).
        """
        results = []
        total = len(posts)

        for i, post in enumerate(posts):
            text = post if isinstance(post, str) else post.get("text", "")
            print(f"[{i+1}/{total}] Publishing ({len(text)} chars)...", file=sys.stderr)

            try:
                result = self.publish(text)
                result["index"] = i
                result["status"] = "published"
                results.append(result)
                print(f"  ✓ Published: {result['post_id']}", file=sys.stderr)
            except Exception as e:
                results.append({
                    "index": i,
                    "status": "failed",
                    "error": str(e),
                    "text_preview": text[:50]
                })
                print(f"  ✗ Failed: {e}", file=sys.stderr)

            if i < total - 1:
                print(f"  Waiting {delay_seconds}s before next post...", file=sys.stderr)
                time.sleep(delay_seconds)

        return results

    # ── Utility ──

    def get_poll_results(self, post_id: str) -> dict:
        """Retrieve poll results for a post with a poll attachment."""
        return self._request("GET", f"/{post_id}", {
            "fields": (
                "poll_attachment{"
                "option_a,option_b,option_c,option_d,"
                "option_a_votes_percentage,option_b_votes_percentage,"
                "option_c_votes_percentage,option_d_votes_percentage,"
                "total_votes,expiration_timestamp"
                "}"
            )
        })

    def delete_post(self, post_id: str) -> dict:
        """Delete a post. Rate limit: 100 deletions per 24hr."""
        return self._request("POST", f"/{post_id}", data={"_method": "DELETE"})

    def repost(self, post_id: str) -> dict:
        """Repost (rethread) an existing post."""
        return self._request("POST", f"/{post_id}/repost")


# ── CLI ──

def _add_common_args(parser):
    """Add --token and --account args shared by all subcommands."""
    parser.add_argument("--token", default=None, help="Access token (falls back to .env)")
    parser.add_argument("--account", choices=["cw", "lf"], default="cw",
                        help="Account alias")


def _parse_spoiler_text(raw: list) -> list:
    """Parse --spoiler-text 'offset:length' args into text_entities."""
    if not raw:
        return None
    entities = []
    for spec in raw:
        parts = spec.split(":")
        if len(parts) != 2:
            print(f"WARNING: Invalid --spoiler-text '{spec}', expected 'offset:length'", file=sys.stderr)
            continue
        entities.append({
            "entity_type": "SPOILER",
            "offset": int(parts[0]),
            "length": int(parts[1]),
        })
    return entities or None


def cmd_me(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    data = api.get_me()
    print(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_search(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    api.get_me()

    if args.multi:
        queries = [q.strip() for q in args.query.split(",")]
        results = api.search_multiple(queries, args.limit)
        output = {
            "searched_at": datetime.now().isoformat(),
            "queries": queries,
            "results": {}
        }
        for q, posts in results.items():
            output["results"][q] = {
                "count": len(posts),
                "top_heat": posts[0]["heat_score"] if posts else 0,
                "posts": posts[:args.limit]
            }
    else:
        posts = api.search(args.query, args.limit)
        output = {
            "searched_at": datetime.now().isoformat(),
            "query": args.query,
            "count": len(posts),
            "posts": posts
        }

    print(json.dumps(output, indent=2, ensure_ascii=False))


def cmd_publish(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    api.get_me()

    # Parse optional attachments
    poll_opts = None
    if args.poll:
        poll_opts = [o.strip() for o in args.poll.split("|") if o.strip()]

    text_entities = _parse_spoiler_text(getattr(args, "spoiler_text", None))

    # Load text attachment from file if provided
    text_attachment = None
    if args.text_attachment:
        if os.path.isfile(args.text_attachment):
            with open(args.text_attachment, "r", encoding="utf-8") as f:
                content = f.read()
            text_attachment = {"plaintext": content[:10000]}
        else:
            # Treat as inline plaintext
            text_attachment = {"plaintext": args.text_attachment[:10000]}

    # Common kwargs for all publish calls
    kwargs = {
        "image_url": args.image,
        "video_url": args.video,
        "poll_options": poll_opts,
        "link_comment": args.link_comment,
        "link_attachment": args.link_attachment,
        "gif_id": args.gif_id,
        "gif_provider": getattr(args, "gif_provider", "GIPHY"),
        "text_attachment": text_attachment,
        "quote_post_id": args.quote_post_id,
        "topic_tag": args.topic_tag,
        "alt_text": args.alt_text,
        "reply_control": args.reply_control,
        "is_spoiler_media": args.spoiler_media,
        "text_entities": text_entities,
        "is_ghost_post": args.ghost,
    }

    if args.thread:
        # Split text by "---" delimiter for thread posts
        parts = [p.strip() for p in args.text.split("---") if p.strip()]
        results = api.publish_thread(parts, **kwargs)
    elif args.carousel:
        results = api.publish_carousel(
            text=args.text,
            media_urls=args.carousel,
            topic_tag=args.topic_tag,
            reply_control=args.reply_control,
            is_spoiler_media=args.spoiler_media,
            text_entities=text_entities,
            quote_post_id=args.quote_post_id,
            alt_text=args.alt_text,
            link_comment=args.link_comment,
        )
    else:
        results = api.publish(args.text, **kwargs)

    print(json.dumps(results, indent=2, ensure_ascii=False))


def cmd_poll_results(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    data = api.get_poll_results(args.post_id)
    print(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_batch_publish(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    api.get_me()

    with open(args.file, "r", encoding="utf-8") as f:
        data = json.load(f)

    posts = data if isinstance(data, list) else data.get("posts", [])
    results = api.batch_publish(posts, args.delay)

    output = {
        "batch_id": datetime.now().strftime("%Y%m%d_%H%M%S"),
        "total": len(posts),
        "published": sum(1 for r in results if r.get("status") == "published"),
        "failed": sum(1 for r in results if r.get("status") == "failed"),
        "delay_seconds": args.delay,
        "results": results
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


def cmd_schedule(args):
    """Generate a scheduling plan based on optimal posting times."""
    with open(args.file, "r", encoding="utf-8") as f:
        data = json.load(f)

    posts = data if isinstance(data, list) else data.get("posts", [])

    # Parse target times
    if args.times:
        times = [t.strip() for t in args.times.split(",")]
    else:
        # Default optimal times from patent analysis
        times = ["21:00", "12:00", "17:30", "07:30"]

    now = datetime.now()
    schedule = []

    for i, post in enumerate(posts):
        text = post if isinstance(post, str) else post.get("text", "")
        time_slot = times[i % len(times)]
        hour, minute = map(int, time_slot.split(":"))

        target = now.replace(hour=hour, minute=minute, second=0)
        if target <= now:
            target += timedelta(days=1)
        target += timedelta(days=i // len(times))

        schedule.append({
            "index": i,
            "text_preview": text[:60] + "..." if len(text) > 60 else text,
            "text_length": len(text),
            "scheduled_time": target.isoformat(),
            "time_slot": time_slot,
            "full_text": text
        })

    output = {
        "schedule_created": now.isoformat(),
        "total_posts": len(posts),
        "time_slots": times,
        "schedule": schedule
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))

    # If --execute flag, actually wait and publish
    if args.execute:
        token = resolve_token(args)
        api = ThreadsAPI(token)
        api.get_me()
        print(f"\n--- EXECUTING SCHEDULE (User: @{api.username}) ---", file=sys.stderr)

        for item in schedule:
            target_time = datetime.fromisoformat(item["scheduled_time"])
            wait_seconds = (target_time - datetime.now()).total_seconds()

            if wait_seconds > 0:
                print(f"Waiting {wait_seconds:.0f}s until {item['time_slot']}...", file=sys.stderr)
                time.sleep(wait_seconds)

            try:
                result = api.publish(item["full_text"])
                print(f"✓ [{item['index']+1}] Published at {item['time_slot']}: {result['post_id']}", file=sys.stderr)
            except Exception as e:
                print(f"✗ [{item['index']+1}] Failed: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Threads API Client — Full Feature Set")
    sub = parser.add_subparsers(dest="command")

    # me
    me_parser = sub.add_parser("me", help="Get current user info")
    _add_common_args(me_parser)

    # search
    search_parser = sub.add_parser("search", help="Search trending posts")
    _add_common_args(search_parser)
    search_parser.add_argument("--query", "-q", required=True)
    search_parser.add_argument("--limit", "-l", type=int, default=20)
    search_parser.add_argument("--multi", action="store_true", help="Comma-separated queries")

    # publish — supports ALL post types and features
    pub_parser = sub.add_parser("publish", help="Publish a post (text/image/video/carousel)")
    _add_common_args(pub_parser)
    pub_parser.add_argument("--text", "-t", required=True, help="Post text (max 500 chars)")
    # Media
    pub_parser.add_argument("--image", default=None, help="Public image URL")
    pub_parser.add_argument("--video", default=None, help="Public video URL (max 5min)")
    pub_parser.add_argument("--carousel", nargs="+", metavar="URL", help="2-20 image/video URLs for carousel")
    # Attachments (TEXT posts only)
    pub_parser.add_argument("--poll", default=None, help="Poll options separated by | (2-4, max 25 chars each)")
    pub_parser.add_argument("--gif-id", default=None, help="GIPHY GIF ID to attach")
    pub_parser.add_argument("--gif-provider", default="GIPHY", choices=["GIPHY"], help="GIF provider (default: GIPHY)")
    pub_parser.add_argument("--link-attachment", default=None, help="URL for link preview card")
    pub_parser.add_argument("--text-attachment", default=None, help="File path or inline text (up to 10,000 chars)")
    # Spoiler
    pub_parser.add_argument("--spoiler-media", action="store_true", help="Blur media (IMAGE/VIDEO/CAROUSEL)")
    pub_parser.add_argument("--spoiler-text", action="append", metavar="OFFSET:LENGTH",
                            help="Mark text range as spoiler (repeatable, max 10)")
    # Special post types
    pub_parser.add_argument("--ghost", action="store_true", help="Ghost post (disappears after 24hr)")
    pub_parser.add_argument("--quote-post-id", default=None, help="ID of post to quote")
    pub_parser.add_argument("--thread", action="store_true", help="Split text by --- into thread")
    # Content controls
    pub_parser.add_argument("--reply-control", default=None, choices=REPLY_CONTROL_VALUES,
                            help="Who can reply")
    pub_parser.add_argument("--topic-tag", default=None, help="Topic tag (1-50 chars, no periods/ampersands)")
    pub_parser.add_argument("--alt-text", default=None, help="Accessibility description (max 1000 chars)")
    # Link comment (auto-reply)
    pub_parser.add_argument("--link-comment", default=None, help="Auto-reply with this link (avoids reach penalty)")

    # poll-results
    poll_parser = sub.add_parser("poll-results", help="Get poll results for a post")
    _add_common_args(poll_parser)
    poll_parser.add_argument("--post-id", required=True, help="Post ID with poll")

    # batch-publish
    batch_parser = sub.add_parser("batch-publish", help="Publish multiple posts from JSON file")
    _add_common_args(batch_parser)
    batch_parser.add_argument("--file", "-f", required=True)
    batch_parser.add_argument("--delay", "-d", type=int, default=1800)

    # schedule
    sched_parser = sub.add_parser("schedule", help="Schedule posts at optimal times")
    _add_common_args(sched_parser)
    sched_parser.add_argument("--file", "-f", required=True)
    sched_parser.add_argument("--times", help="Comma-separated times, e.g. '21:00,12:00'")
    sched_parser.add_argument("--execute", action="store_true", help="Actually wait and publish")

    args = parser.parse_args()

    commands = {
        "me": cmd_me,
        "search": cmd_search,
        "publish": cmd_publish,
        "poll-results": cmd_poll_results,
        "batch-publish": cmd_batch_publish,
        "schedule": cmd_schedule,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
