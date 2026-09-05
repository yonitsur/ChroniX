import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Timeline } from 'histropediajs';
import { getLaneColor, isColorLight } from '../data/laneColors';

const TimelineView = forwardRef(({
  timelineData,
  onSelectArticle,
  selectedArticleId,
  theme = 'light'
}, ref) => {
  const containerRef = useRef(null);
  const timelineInstanceRef = useRef(null);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(currentZoom + 4);
      }
    },
    zoomOut: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(Math.max(0, currentZoom - 4));
      }
    },
    fitAll: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        tl.fitArticles({ padding: 60 });
      }
    },
    focusArticle: (articleId) => {
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        const art = tl.getArticleById(articleId);
        if (art) {
          try {
            tl.fitArticleRange(art, { padding: 120 });
          } catch (e) {
            console.warn('fitArticleRange fallback:', e);
            const date = art.from || art.data?.from || art.period?.from;
            if (date) {
              tl.setCentreDate(date);
            }
          }
          try {
            tl.select(articleId);
            tl.bringFront(articleId);
          } catch (e) {
            // ignore
          }
        }
      }
    },
    getCanvas: () => {
      return timelineInstanceRef.current?.canvas || null;
    }
  }));

  useEffect(() => {
    if (!containerRef.current || !timelineData) return;

    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 600;

    const isDark = theme === 'dark';

    // Find a reasonable initial date
    let initialDate = { year: 1950, month: 1, day: 1 };
    if (timelineData.articles && timelineData.articles.length > 0) {
      const first = timelineData.articles[0];
      if (first.from) {
        initialDate = {
          year: first.from.year,
          month: first.from.month || 1,
          day: first.from.day || 1,
        };
      }
    }

    const articleStyle = {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      color: isDark ? '#1e293b' : '#f1f5f9',
      topRadius: 6,
      borderRadius: 6,
      border: {
        color: isDark ? '#334155' : '#cbd5e1',
        width: 1,
      },
      header: {
        height: 50,
        text: {
          font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#f8fafc' : '#0f172a',
          margin: 10,
          lineHeight: 18,
          numberOfLines: 2,
        }
      },
      subheader: {
        height: 26,
        color: isDark ? '#0b1120' : '#e2e8f0',
        text: {
          font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#94a3b8' : '#64748b',
          margin: 10,
          lineHeight: 14,
        }
      },
      shadow: {
        x: 0,
        y: 3,
        amount: isDark ? 8 : 4,
        color: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.08)',
      },
      connectorLine: {
        visible: true,
        thickness: 1.5,
        color: isDark ? '#475569' : '#94a3b8',
      }
    };

    try {
      const options = {
        width,
        height,
        initialDate,
        disableBranding: true,
        enableUserControl: true,
        enableCursor: true,
        verticalOffset: 45,
        style: {
          mainLine: {
            visible: true,
            size: 8,
          },
          dateLabel: {
            minor: {
              color: isDark ? '#94a3b8' : '#475569',
            },
            major: {
              color: isDark ? '#f8fafc' : '#0f172a',
            }
          },
          marker: {
            minor: {
              color: isDark ? '#38bdf8' : '#0284c7',
            },
            major: {
              color: isDark ? '#818cf8' : '#4338ca',
            }
          }
        },
        lane: {
          visible: true,
          gap: 16,
          axisGap: 30,
          defaultStyle: {
            header: {
              backgroundColor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(241, 245, 249, 0.95)',
            },
            body: {
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.65)',
              borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.8)',
            },
            title: {
              color: isDark ? '#f1f5f9' : '#1e293b',
              font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            }
          }
        },
        timeBand: {
          visible: true,
          reserveSpace: true,
        },
        article: {
          cardLayout: 'portrait',
          draggable: true,
          autoStacking: {
            active: true,
            fitToHeight: true,
            rowSpacing: 40,
          },
          periodLine: {
            thickness: 6,
            spacing: 4,
          },
          defaultStyle: articleStyle,
          defaultHoverStyle: {
            color: isDark ? '#334155' : '#e2e8f0',
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: {
              color: isDark ? '#38bdf8' : '#0284c7',
              width: 1.5,
            },
            shadow: {
              x: 0,
              y: 6,
              amount: 14,
              color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
            }
          },
          defaultActiveStyle: {
            color: isDark ? '#1e3a8a' : '#bfdbfe',
            backgroundColor: isDark ? '#172554' : '#eff6ff',
            border: {
              color: '#38bdf8',
              width: 2,
            },
            header: {
              text: {
                color: isDark ? '#ffffff' : '#0f172a',
              }
            },
            subheader: {
              color: isDark ? '#1e40af' : '#dbeafe',
              text: {
                color: isDark ? '#93c5fd' : '#1e40af',
              }
            }
          }
        }
      };

      const timeline = new Timeline(container, options);
      timelineInstanceRef.current = timeline;

      // 1. Load lanes if any
      if (timelineData.lanes && timelineData.lanes.length > 0) {
        timeline.loadLanes(
          timelineData.lanes.map((l, idx) => {
            const laneColor = getLaneColor(l, idx, timelineData.lanes);
            const isLight = isColorLight(laneColor);
            const textColor = isLight ? '#0f172a' : '#ffffff';

            return {
              id: l.id,
              title: l.title,
              layout: {
                header: {
                  height: 28,
                  padding: { left: 14, right: 14 }
                }
              },
              style: {
                header: {
                  backgroundColor: laneColor,
                },
                body: {
                  backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.65)',
                  borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.8)',
                },
                title: {
                  color: textColor,
                  font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
                }
              }
            };
          })
        );
      }

      // Helper to tone down timeband background in dark mode
      const formatBandBg = (color) => {
        if (!color) return isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.08)';
        if (typeof color === 'string' && color.startsWith('rgba')) {
          return isDark ? color.replace(/[\d\.]+\)$/, '0.12)') : color;
        }
        if (typeof color === 'string' && color.startsWith('#')) {
          let hex = color.slice(1);
          if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
          if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.12 : 0.09})`;
          }
        }
        return color;
      };

      // 2. Load time bands if any
      if (timelineData.timeBands && timelineData.timeBands.length > 0) {
        timeline.loadTimeBands(
          timelineData.timeBands.map((tb) => ({
            id: tb.id,
            title: tb.title,
            from: tb.from,
            to: tb.to,
            style: {
              background: formatBandBg(tb.color),
            }
          }))
        );
      }

      // 3. Load articles
      if (timelineData.articles && timelineData.articles.length > 0) {
        const formattedArticles = timelineData.articles.map((art) => ({
          ...art,
          id: art.id,
          title: art.title,
          subtitle: art.subtitle || '',
          lane: art.lane,
          from: art.from,
          to: art.to || undefined,
          isToPresent: art.isToPresent || false,
          imageUrl: art.imageUrl || undefined,
          rank: art.rank || 5,
          style: articleStyle,
          // Attach custom rich data into article object for drawer
          wikiUrl: art.wikiUrl,
          extract: art.extract,
          wikiTitle: art.wikiTitle,
          locationName: art.locationName,
          lat: art.lat,
          lng: art.lng,
          googleMapsUrl: art.googleMapsUrl,
        }));

        timeline.load(formattedArticles);

        // Fit articles in view
        setTimeout(() => {
          try {
            timeline.fitArticles({ padding: 70 });
          } catch (e) {
            console.warn('fitArticles fallback:', e);
          }
        }, 100);
      }

      // Event listener for article clicks
      timeline.on('article-click', (article) => {
        if (onSelectArticle) {
          const clickedId = article?.id || article?.data?.id;
          const original = timelineData.articles?.find((a) => a.id === clickedId);
          onSelectArticle(original || article.data || article);
        }
      });

    } catch (err) {
      console.error('Histropedia initialization failed:', err);
    }

    // Resize observer to keep canvas full size
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0 && timelineInstanceRef.current) {
          try {
            timelineInstanceRef.current.setSize(newWidth, newHeight);
          } catch (e) {
            // ignore during unmount
          }
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      timelineInstanceRef.current = null;
      container.innerHTML = '';
    };
  }, [timelineData, theme]);

  return (
    <div
      dir="ltr"
      className="w-full h-full relative overflow-hidden bg-slate-100 dark:bg-slate-950 select-none transition-colors duration-200 histropedia-timeline-wrapper"
    >
      <div
        ref={containerRef}
        id="histropedia-container"
        dir="ltr"
        className="w-full h-full absolute inset-0"
      />
    </div>
  );
});

TimelineView.displayName = 'TimelineView';
export default TimelineView;
