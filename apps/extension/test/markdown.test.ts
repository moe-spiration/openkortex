import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/lib/markdown";

describe("htmlToMarkdown", () => {
  it("converts inline formatting, lists and links", () => {
    const md = htmlToMarkdown(
      '<p>Hello <strong>bold</strong> and <em>it</em> <code>x()</code> <a href="https://a.b/c">link</a></p><ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol>',
    );
    expect(md).toBe("Hello **bold** and *it* `x()` [link](https://a.b/c)\n\n- one\n- two\n\n1. a\n2. b");
  });

  it("keeps fenced code blocks with language and drops copy-button chrome", () => {
    const md = htmlToMarkdown(
      '<pre><div><div>python<button>Copy code</button></div><code class="hljs language-python">print("hi")\nx = 1\n</code></div></pre>',
    );
    expect(md).toBe('```python\nprint("hi")\nx = 1\n```');
  });

  it("uses a longer fence when the code contains backticks and omits unknown languages", () => {
    expect(htmlToMarkdown("<pre><code>a ``` b</code></pre>")).toBe("````\na ``` b\n````");
  });

  it("renders tables in GFM", () => {
    const md = htmlToMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td><td><b>x</b></td></tr></table>");
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 \\| 2 | **x** |");
  });

  it("keeps TeX from KaTeX and drops the rendered duplicate", () => {
    const md = htmlToMarkdown(
      '<p>E: <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html">E=mc2</span></span></p>',
    );
    expect(md).toBe("E: $E=mc^2$");
  });

  it("shifts headings below the transcript structure", () => {
    expect(htmlToMarkdown("<h1>T</h1><h2>S</h2><h5>Deep</h5>", { headingOffset: 3 })).toBe(
      "#### T\n\n##### S\n\n###### Deep",
    );
    expect(htmlToMarkdown("<h2>S</h2>")).toBe("## S");
  });

  it("drops buttons, svgs and scripts", () => {
    expect(htmlToMarkdown("<p>Text<button>Copy</button><svg><path/></svg><script>alert(1)</script></p>")).toBe("Text");
  });

  it("collapses runs of blank lines", () => {
    expect(htmlToMarkdown("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});
