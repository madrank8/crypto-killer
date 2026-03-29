'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useCallback } from 'react';

/* ─── Toolbar Button ─── */
function TBtn({ label, isActive, onClick, disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1.5 rounded text-xs font-semibold transition ${
        isActive
          ? 'bg-brand-green text-black'
          : 'text-gray-300 hover:bg-gray-600 hover:text-white'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
      title={label}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-6 bg-gray-600 mx-0.5" />;
}

/* ─── Toolbar ─── */
function MenuBar({ editor }) {
  if (!editor) return null;

  const setLink = useCallback(() => {
    const prev = editor.getAttributes('link').href;
    const url = prompt('URL:', prev || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  const addImage = useCallback(() => {
    const url = prompt('Image URL:');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 p-2 bg-dark-surface border-b border-gray-700">
      {/* Text formatting */}
      <TBtn label="B" isActive={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <TBtn label="I" isActive={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <TBtn label="U" isActive={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <TBtn label="S" isActive={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <TBtn label="Code" isActive={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />

      <Divider />

      {/* Headings */}
      <TBtn label="H1" isActive={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <TBtn label="H2" isActive={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <TBtn label="H3" isActive={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <TBtn label="¶" isActive={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} />

      <Divider />

      {/* Lists */}
      <TBtn label="• List" isActive={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <TBtn label="1. List" isActive={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />

      <Divider />

      {/* Alignment */}
      <TBtn label="←" isActive={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
      <TBtn label="↔" isActive={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
      <TBtn label="→" isActive={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />

      <Divider />

      {/* Block elements */}
      <TBtn label="Quote" isActive={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <TBtn label="Code ▣" isActive={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <TBtn label="─ HR" onClick={() => editor.chain().focus().setHorizontalRule().run()} />

      <Divider />

      {/* Links & media */}
      <TBtn label="🔗 Link" isActive={editor.isActive('link')} onClick={setLink} />
      <TBtn label="🖼 Image" onClick={addImage} />

      <Divider />

      {/* Undo / Redo */}
      <TBtn label="↩" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
      <TBtn label="↪" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
    </div>
  );
}

/* ─── Main Component ─── */
export default function TipTapEditor({ content, onChange, placeholder }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'text-brand-green underline' },
      }),
      Image.configure({
        HTMLAttributes: { class: 'max-w-full rounded my-3' },
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing your review...',
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'min-h-[500px] p-4 focus:outline-none prose prose-invert max-w-none text-gray-200',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Update content from outside (e.g. AI generate)
  useEffect(() => {
    if (editor && content !== undefined) {
      const currentHTML = editor.getHTML();
      // Only update if content genuinely changed from outside
      if (content !== currentHTML && content !== '') {
        editor.commands.setContent(content, false);
      }
    }
  }, [content, editor]);

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-dark-bg">
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
