'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function FaqAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(null)

  if (!items || items.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={index}
          className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900/40 hover:bg-slate-900/60 transition-colors"
        >
          <button
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors"
          >
            <h3 className="text-base font-semibold text-slate-100 pr-4">
              {item.question}
            </h3>
            <ChevronDown
              size={20}
              className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${
                openIndex === index ? 'transform rotate-180' : ''
              }`}
            />
          </button>

          {openIndex === index && (
            <div className="px-6 py-4 bg-slate-950/50 border-t border-slate-800">
              <p className="text-slate-300 leading-relaxed text-sm">
                {item.answer}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
