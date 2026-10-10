import React from 'react';
import CardsListDrawer from '../CardsListDrawer';

export default function TimelineCardFeed(props) {
  return (
    <CardsListDrawer
      {...props}
      presentation="page"
      isOpen
    />
  );
}
