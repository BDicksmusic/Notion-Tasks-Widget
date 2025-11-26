import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints';
import type { MarkdownBlock, MarkdownRichText } from '@shared/types';

type NotionCodeBlockRequest = Extract<BlockObjectRequest, { type: 'code' }>;

export function textToRichText(content: string) {
  return [
    {
      type: 'text' as const,
      text: { content }
    }
  ];
}

export function markdownBlocksToNotion(
  blocks: MarkdownBlock[]
): BlockObjectRequest[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'paragraph':
        return {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: markdownRichTextToNotion(block.richText)
          }
        };
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return {
          object: 'block',
          type: block.type,
          [block.type]: {
            rich_text: markdownRichTextToNotion(block.richText)
          }
        } as BlockObjectRequest;
      case 'bulleted_list_item':
      case 'numbered_list_item':
        return {
          object: 'block',
          type: block.type,
          [block.type]: {
            rich_text: markdownRichTextToNotion(block.richText)
          }
        } as BlockObjectRequest;
      case 'to_do':
        return {
          object: 'block',
          type: 'to_do',
          to_do: {
            checked: block.checked,
            rich_text: markdownRichTextToNotion(block.richText)
          }
        };
      case 'quote':
        return {
          object: 'block',
          type: 'quote',
          quote: {
            rich_text: markdownRichTextToNotion(block.richText)
          }
        };
      case 'code':
        return {
          object: 'block',
          type: 'code',
          code: {
            language: (block.language ??
              'plain text') as NotionCodeBlockRequest['code']['language'],
            rich_text: markdownRichTextToNotion(block.richText)
          }
        };
      case 'divider':
        return {
          object: 'block',
          type: 'divider',
          divider: {}
        };
      case 'toggle':
        return {
          object: 'block',
          type: 'toggle',
          toggle: {
            rich_text: markdownRichTextToNotion(block.richText),
            children:
              block.children && block.children.length
                ? markdownBlocksToNotion(block.children)
                : undefined
          }
        } as BlockObjectRequest;
      default: {
        const exhaustiveCheck: never = block;
        throw new Error(
          `Unsupported markdown block: ${JSON.stringify(exhaustiveCheck)}`
        );
      }
    }
  });
}

export function markdownRichTextToNotion(segments: MarkdownRichText[]) {
  if (!segments.length) {
    return textToRichText('');
  }
  return segments.map((segment) => ({
    type: 'text' as const,
    text: {
      content: segment.text,
      link: segment.href ? { url: segment.href } : null
    },
    annotations: {
      bold: Boolean(segment.annotations?.bold),
      italic: Boolean(segment.annotations?.italic),
      underline: Boolean(segment.annotations?.underline),
      strikethrough: Boolean(segment.annotations?.strikethrough),
      code: Boolean(segment.annotations?.code),
      color: 'default'
    },
    href: segment.href ?? null
  }));
}


