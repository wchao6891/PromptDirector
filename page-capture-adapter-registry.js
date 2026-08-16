const GENERIC_CARD_SELECTORS = Object.freeze(["main article", "[role=main] article"]);
const EMPTY_FIELDS = Object.freeze({});

export const GENERIC_PAGE_CAPTURE_ADAPTER = Object.freeze({
  id: "generic",
  label: "通用网页",
  support: "generic",
  hosts: Object.freeze([]),
  cardSelectors: GENERIC_CARD_SELECTORS,
  fields: EMPTY_FIELDS,
  trustedMediaHosts: Object.freeze([])
});

export const PAGE_CAPTURE_ADAPTERS = Object.freeze([
  adapter("jimeng", "即梦", ["jimeng.jianying.com"], "verified-deep", ["[data-testid*=work]", "[class*=masonry] > *"], {
    title: ["[class*=title]"], author: ["[class*=author]"], model: ["[class*=model]"]
  }, ["byteimg.com"]),
  adapter("liblibai", "LiblibAI", ["liblib.art", "liblib.ai"], "verified-deep", ["[class*=work-card]", "[class*=waterfall] > *"], {}, ["liblib.cloud"]),
  adapter("higgsfield", "Higgsfield", ["higgsfield.ai"], "verified-declarative", ["[data-testid*=creation]", "[class*=feed] > article"], {}, ["higgsfield.ai", "higgs.ai", "d2ol7oe51mr4n9.cloudfront.net", "du4zrvwy3vtek.cloudfront.net", "d8j0ntlcm91z4.cloudfront.net"]),
  adapter("krea", "Krea", ["krea.ai"], "verified-declarative", ["a[href^='/feed/']", "[data-testid*=generation]", "[class*=gallery] > *"], {}, ["krea.ai"]),
  adapter("tapnow", "TapNow", ["tapnow.ai"], "generic", ["[data-testid*=work]", "[class*=gallery] > *"]),

  adapter("pinterest", "Pinterest", ["pinterest.com", "pin.it"], "verified-deep", ["[data-test-id=pin]", "[data-grid-item]"], {}, ["i.pinimg.com"]),
  adapter("behance", "Behance", ["behance.net"], "verified-declarative", ["[data-project-id]", "main article"], {}, ["mir-s3-cdn-cf.behance.net"]),
  adapter("dribbble", "Dribbble", ["dribbble.com"], "generic", ["[data-thumbnail-id]", "main article"]),
  adapter("artstation", "ArtStation", ["artstation.com"], "generic", [".project", "[data-test=project-card]"]),
  adapter("deviantart", "DeviantArt", ["deviantart.com"], "generic", ["main article", "[data-hook=deviation_link]"]),
  adapter("designspiration", "Designspiration", ["designspiration.com"], "generic", ["main article", "[data-testid*=save]"]),
  adapter("huaban", "花瓣", ["huaban.com"], "generic", ["[data-id][data-type=pin]", "main article"]),
  adapter("zcool", "站酷", ["zcool.com.cn"], "generic", ["main article", "[class*=work-card]"]),
  adapter("500px", "500px", ["500px.com"], "generic", ["main article", "[data-testid*=photo]"]),
  adapter("flickr", "Flickr", ["flickr.com", "flic.kr"], "generic", ["main article", "[class*=photo-list-photo]"]),
  adapter("pexels", "Pexels", ["pexels.com"], "generic", ["main article", "[data-testid*=media-grid]"]),

  adapter("instagram", "Instagram", ["instagram.com"], "generic", ["main article", "article"]),
  adapter("x", "X", ["x.com", "twitter.com"], "generic", ["article[data-testid=tweet]"], {
    author: ["[data-testid=User-Name] a[href^='/'] span:first-child", "[data-testid=User-Name]"], handle: ["[data-testid=User-Name] a[href^='/']"],
    canonicalUrl: ["a[href*='/status/']"], publishedAt: ["time"], likes: ["[data-testid=like]"], reposts: ["[data-testid=retweet]"]
  }),
  adapter("reddit", "Reddit", ["reddit.com", "redd.it"], "generic", ["shreddit-post", "article"], {
    title: ["[slot=title]", "h1,h2,h3"], author: ["[slot=authorName]", "[class*=author]"], publishedAt: ["time"]
  }),
  adapter("imgur", "Imgur", ["imgur.com"], "generic", ["main article", "[class*=Gallery-Content]"]),
  adapter("weibo", "微博", ["weibo.com", "weibo.cn"], "generic", ["article", "[class*=Feed_wrap]"]),
  adapter("jike", "即刻", ["okjike.com"], "generic", ["main article", "[data-testid*=post]"]),
  adapter("qzone", "QQ 空间相册", ["qzone.qq.com", "photo.qq.com"], "generic", ["main article", "[class*=photo]"]),
  adapter("douban", "豆瓣相册", ["douban.com"], "generic", ["main article", ".photo_wrap", ".photolst li"]),
  adapter("poco", "POCO", ["poco.cn"], "generic", ["main article", "[class*=work]"]),

  adapter("wechat", "微信公众号", ["mp.weixin.qq.com"], "verified-declarative", ["#js_content"], {
    title: ["#activity-name"], author: ["#js_name"], publishedAt: ["#publish_time", "em#publish_time"]
  }, ["qpic.cn", "qlogo.cn"]),
  adapter("medium", "Medium", ["medium.com"], "generic", ["main article", "article"]),

  adapter("jd", "京东", ["jd.com"], "generic", ["main", "[class*=product-intro]"]),
  adapter("taobao", "淘宝", ["taobao.com"], "generic", ["main", "[class*=Item]"]),
  adapter("tmall", "天猫", ["tmall.com"], "generic", ["main", "[class*=Item]"]),
  adapter("1688", "1688", ["1688.com"], "generic", ["main", "[class*=offer]"]),
  adapter("mogujie", "蘑菇街", ["mogujie.com"], "generic", ["main", "[class*=detail]"]),

  adapter("architectural-digest", "Architectural Digest", ["architecturaldigest.com"], "generic", ["main article", "article"]),
  adapter("archiproducts", "Archiproducts", ["archiproducts.com"], "generic", ["main article", "main"]),
  adapter("houzz", "Houzz", ["houzz.com"], "generic", ["main article", "main"]),
  adapter("house-beautiful", "House Beautiful", ["housebeautiful.com"], "generic", ["main article", "article"]),
  adapter("officesnapshots", "OfficeSnapshots", ["officesnapshots.com"], "generic", ["main article", "article"]),
  adapter("archilovers", "Archilovers", ["archilovers.com"], "generic", ["main article", "main"]),
  adapter("archdaily", "ArchDaily", ["archdaily.com"], "generic", ["main article", "article"]),
  adapter("archdaily-cn", "ArchDaily 中文", ["archdaily.cn"], "generic", ["main article", "article"]),
  adapter("dezeen", "Dezeen", ["dezeen.com"], "generic", ["main article", "article"]),
  adapter("interior-design", "Interior Design", ["interiordesign.net"], "generic", ["main article", "article"]),

  adapter("youtube", "YouTube", ["youtube.com", "youtu.be"], "generic", ["ytd-rich-item-renderer", "ytd-video-renderer"], {
    title: ["#video-title"], author: ["#channel-name"], views: ["#metadata-line span"]
  }),
  adapter("bilibili", "哔哩哔哩", ["bilibili.com", "b23.tv"], "generic", [".bili-video-card", ".video-card"]),
  adapter("steam", "Steam", ["steampowered.com", "steamcommunity.com"], "generic", [".apphub_Card", ".search_result_row", ".workshopItem"])
]);

export const PAGE_CAPTURE_PLATFORM_ADAPTERS = Object.freeze([
  platformAdapter("wordpress", "WordPress", { generator: ["\\bwordpress\\b"], links: ["/wp-(?:content|includes)/"] }),
  platformAdapter("wix", "Wix", { generator: ["\\bwix\\b"], applicationName: ["\\bwix\\b"], scripts: ["(?:parastorage|wixstatic|wix-thunderbolt)"], links: ["(?:parastorage|wixstatic|wix-thunderbolt)"] }),
  platformAdapter("squarespace", "Squarespace", { generator: ["\\bsquarespace\\b"], applicationName: ["\\bsquarespace\\b"], scripts: ["squarespace(?:\\.com|-cdn)"], links: ["squarespace(?:\\.com|-cdn)"] }),
  platformAdapter("medium", "Medium", { generator: ["\\bmedium\\b"], applicationName: ["\\bmedium\\b"], links: ["medium\\.com"] })
]);

export function resolvePageCaptureAdapter(value, signalsValue = {}, adapters = PAGE_CAPTURE_ADAPTERS) {
  const host = hostname(value);
  const direct = adapters.find((item) => item.hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)));
  if (direct) return direct;
  const signals = normalizeSignals(signalsValue);
  return PAGE_CAPTURE_PLATFORM_ADAPTERS.find((item) => matchesPlatformSignals(item, signals)) || GENERIC_PAGE_CAPTURE_ADAPTER;
}

export function pageCaptureSupportMatrix() {
  return [...PAGE_CAPTURE_ADAPTERS, ...PAGE_CAPTURE_PLATFORM_ADAPTERS].map(({ id, label, hosts = [], support }) => ({
    id, label, hosts: [...hosts], support
  }));
}

function adapter(id, label, hosts, support, cardSelectors, fields = EMPTY_FIELDS, trustedMediaHosts = []) {
  return Object.freeze({
    id,
    label,
    support,
    pageType: defaultPageType(id),
    hosts: Object.freeze([...hosts]),
    cardSelectors: Object.freeze([...cardSelectors]),
    fields: Object.freeze({ ...fields }),
    trustedMediaHosts: Object.freeze([...trustedMediaHosts])
  });
}

function platformAdapter(id, label, signalPatterns) {
  return Object.freeze({
    id,
    label,
    support: "generic",
    pageType: id === "medium" ? "article" : "generic",
    hosts: Object.freeze([]),
    cardSelectors: GENERIC_CARD_SELECTORS,
    fields: EMPTY_FIELDS,
    trustedMediaHosts: Object.freeze([]),
    signalPatterns: Object.freeze(Object.fromEntries(Object.entries(signalPatterns).map(([key, values]) => [key, Object.freeze([...values])])))
  });
}

function defaultPageType(id) {
  if (["youtube", "bilibili"].includes(id)) return "video";
  if (["x", "reddit", "instagram", "weibo", "jike"].includes(id)) return "post";
  if (["wechat", "medium", "architectural-digest", "house-beautiful", "officesnapshots", "archdaily", "archdaily-cn", "dezeen", "interior-design"].includes(id)) return "article";
  return "artwork";
}

function matchesPlatformSignals(adapterValue, signals) {
  return Object.entries(adapterValue.signalPatterns || {}).some(([key, patterns]) => {
    const values = Array.isArray(signals[key]) ? signals[key] : [signals[key]];
    return patterns.some((pattern) => values.some((value) => {
      try { return new RegExp(pattern, "iu").test(value); } catch { return false; }
    }));
  });
}

function normalizeSignals(value = {}) {
  const metas = value?.metas && typeof value.metas === "object" ? value.metas : {};
  return {
    generator: clean(metas.generator || value.generator),
    applicationName: clean(metas.applicationName || value.applicationName),
    scripts: stringList(value.scripts),
    links: stringList(value.links)
  };
}

function stringList(value) {
  return (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
}

function hostname(value) {
  try { return new URL(String(value ?? "")).hostname.toLocaleLowerCase("en-US"); }
  catch { return clean(value).toLocaleLowerCase("en-US"); }
}

function clean(value) {
  return String(value ?? "").trim();
}
